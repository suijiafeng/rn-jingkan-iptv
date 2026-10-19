import { fetch as expoFetch } from "expo/fetch";
import { readBoundedStream } from "../../data/importIO";
import { linkedDeadline } from "../../lib/abort";
import { normalizeLanguages } from "../../domain/channelFacets";

/** Public iptv-org database; fetched only when the user asks for it. */
export const IPTV_ORG_FEEDS_URL = "https://iptv-org.github.io/api/feeds.json";
/** About 8 MB in 2026-10; bounded with headroom. */
export const MAX_FEEDS_BYTES = 24 * 1024 * 1024;
export const FEEDS_TIMEOUT_MS = 120_000;

export class LanguageLookupError extends Error {}

/**
 * Picks languages for the wanted tvg-ids out of iptv-org feeds.json.
 * "Name.cc@Feed" matches that feed; a bare "Name.cc" uses the main feed.
 * Untrusted input: anything not shaped like a feed record is skipped.
 */
export function languagesFromFeeds(
  feeds: unknown,
  wanted: ReadonlySet<string>,
): Map<string, string[]> {
  const found = new Map<string, string[]>();
  if (!Array.isArray(feeds)) return found;
  for (const feed of feeds as unknown[]) {
    if (!feed || typeof feed !== "object") continue;
    const { channel, id, is_main, languages } = feed as Record<string, unknown>;
    if (typeof channel !== "string" || typeof id !== "string") continue;
    if (!Array.isArray(languages)) continue;
    const codes = normalizeLanguages(
      languages
        .filter((code): code is string => typeof code === "string")
        .join(";"),
    );
    if (!codes.length) continue;
    const full = `${channel}@${id}`;
    if (wanted.has(full)) found.set(full, codes);
    if (is_main === true && wanted.has(channel) && !found.has(channel))
      found.set(channel, codes);
  }
  return found;
}

/** One bounded download of feeds.json, cancellable through `signal`. */
export async function lookupIptvOrgLanguages(
  wanted: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<Map<string, string[]>> {
  const deadline = linkedDeadline(signal, FEEDS_TIMEOUT_MS);
  try {
    const response = await expoFetch(IPTV_ORG_FEEDS_URL, {
      signal: deadline.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok || !response.body)
      throw new LanguageLookupError(
        `iptv-org 数据库暂时无法访问（HTTP ${response.status}），请稍后重试`,
      );
    const text = await readBoundedStream(
      response.body,
      deadline.signal,
      MAX_FEEDS_BYTES,
    );
    return languagesFromFeeds(JSON.parse(text), wanted);
  } catch (error) {
    if (error instanceof LanguageLookupError) throw error;
    throw new LanguageLookupError(
      signal.aborted
        ? "已停止补全语言"
        : deadline.timedOut
          ? "下载 iptv-org 数据库超时，请检查网络后重试"
          : "无法读取 iptv-org 数据库，请检查网络后重试",
    );
  } finally {
    deadline.close();
  }
}
