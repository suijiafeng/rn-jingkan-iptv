import type {
  ImportIssue,
  ImportIssueReason,
  ImportPreview,
  ParsedChannel,
} from "./types";
import { normalizeRemoteUrl, UrlValidationError } from "./url";
import { normalizeGroups } from "./channelLabels";
import { normalizeCountries, normalizeLanguages } from "./channelFacets";

// 8 MiB fits the full iptv-org index (~2.5 MiB, 11k+ entries) with headroom;
// still bounded because the text is held in memory while parsing.
export const M3U_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxLineBytes: 64 * 1024,
  maxEntries: 20_000,
  yieldEveryLines: 200,
});
const HLS_STRUCTURE_TAG =
  /^#EXT-X-(?:TARGETDURATION|MEDIA-SEQUENCE|DISCONTINUITY-SEQUENCE|STREAM-INF|I-FRAME-STREAM-INF|MEDIA|KEY|MAP|BYTERANGE|PLAYLIST-TYPE|ENDLIST|PART-INF|PART|SERVER-CONTROL)(?=[:\s]|$)/i;
export const MAX_MIB = M3U_LIMITS.maxBytes / 1024 / 1024;
export type M3UErrorCode =
  | "empty"
  | "missing_header"
  | "invalid_encoding"
  | "too_large"
  | "line_too_long"
  | "too_many_entries"
  | "hls_playlist"
  | "no_channels"
  | "cancelled";
export class M3UParseError extends Error {
  constructor(public readonly code: M3UErrorCode) {
    super(
      {
        empty: "文件内容为空。",
        missing_header: "这不是有效的 M3U 频道目录（缺少 #EXTM3U）。",
        invalid_encoding: "文件不是有效的 UTF-8 文本，请重新导出为 UTF-8。",
        too_large: `节目单超过 ${MAX_MIB} MiB 上限。`,
        line_too_long: "节目单有一行超过 64 KiB 上限。",
        too_many_entries: "节目单超过 20,000 条目上限。",
        hls_playlist: "这是 HLS 播放地址，不是频道目录。",
        no_channels: "节目单中没有可导入的有效频道。",
        cancelled: "已取消导入。",
      }[code],
    );
    this.name = "M3UParseError";
  }
}

export interface ParseM3UOptions {
  /** Final network playlist URL, never a local file URI. */
  baseUrl?: string;
  signal?: AbortSignal;
  /** Tests can inject a scheduler; production yields to the event loop. */
  yieldControl?: () => Promise<void>;
}

/** Also validates surrogate pairs; U+FFFD is rejected conservatively after lossy decodes. */
export function utf8ByteLength(value: string): number {
  let length = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0xfffd) throw new M3UParseError("invalid_encoding");
    if (code < 0x80) length += 1;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff))
        throw new M3UParseError("invalid_encoding");
      length += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff)
      throw new M3UParseError("invalid_encoding");
    else length += 3;
  }
  return length;
}

interface PendingChannel {
  name: string;
  groupName: string;
  tvgId: string | null;
  logoUrl: string | null;
  countries: string[];
  languages: string[];
  line: number;
}
interface Candidate extends PendingChannel {
  streamUrl: string;
}

function parseExtinf(line: string, lineNumber: number): PendingChannel | null {
  let quote = "";
  let comma = -1;
  for (let i = 8; i < line.length; i += 1) {
    const char = line[i];
    if ((char === '"' || char === "'") && (i === 0 || line[i - 1] !== "\\")) {
      if (!quote) quote = char;
      else if (quote === char) quote = "";
    }
    if (char === "," && !quote) {
      comma = i;
      break;
    }
  }
  if (comma < 0 || quote) return null;
  const attributes: Record<string, string> = {};
  const prefix = line.slice(8, comma);
  const attribute =
    /([\w-]+)\s*=\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attribute.exec(prefix))) {
    attributes[match[1].toLowerCase()] = (
      match[2] ??
      match[3] ??
      match[4] ??
      ""
    )
      .replace(/\\(["'\\])/g, "$1")
      .trim();
  }
  return {
    name:
      line.slice(comma + 1).trim() || attributes["tvg-name"] || "未命名频道",
    groupName: normalizeGroups(attributes["group-title"]),
    tvgId: attributes["tvg-id"] || null,
    // Loading remote artwork requires a separate informed application consent.
    logoUrl: attributes["tvg-logo"] || null,
    countries: normalizeCountries(
      attributes["tvg-country"] || attributes.country,
    ),
    languages: normalizeLanguages(
      attributes["tvg-language"] || attributes.language,
    ),
    line: lineNumber,
  };
}

/** Bounded text parser, not a streaming downloader. No network requests are made. */
export async function parseM3U(
  text: string,
  options: ParseM3UOptions = {},
): Promise<ImportPreview> {
  const checkCancelled = () => {
    if (options.signal?.aborted) throw new M3UParseError("cancelled");
  };
  checkCancelled();
  if (!text.trim()) throw new M3UParseError("empty");
  if (text.length > M3U_LIMITS.maxBytes) throw new M3UParseError("too_large");
  const baseUrl = options.baseUrl
    ? normalizeRemoteUrl(options.baseUrl)
    : undefined;
  const yieldControl =
    options.yieldControl ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const issues: ImportIssue[] = [];
  const issueCounts: ImportPreview["issueCounts"] = {};
  const candidates: Candidate[] = [];
  const stats = {
    valid: 0,
    duplicates: 0,
    ignored: 0,
    total: 0,
    http: 0,
    bytes: 0,
    lines: 0,
  };
  let pending: PendingChannel | null = null;
  let headerSeen = false;
  const addIssue = (line: number, reason: ImportIssueReason) => {
    issueCounts[reason] = (issueCounts[reason] ?? 0) + 1;
    if (issues.length < 100) issues.push({ line, reason });
    if (reason === "duplicate") stats.duplicates += 1;
    else stats.ignored += 1;
  };
  const countEntry = () => {
    stats.total += 1;
    if (stats.total > M3U_LIMITS.maxEntries)
      throw new M3UParseError("too_many_entries");
  };
  let start = 0;
  while (start < text.length) {
    checkCancelled();
    const end = text.indexOf("\n", start);
    const hasNewline = end >= 0;
    const rawLine = text.slice(start, hasNewline ? end : text.length);
    const bytes = utf8ByteLength(rawLine);
    if (bytes > M3U_LIMITS.maxLineBytes)
      throw new M3UParseError("line_too_long");
    stats.bytes += bytes + (hasNewline ? 1 : 0);
    if (stats.bytes > M3U_LIMITS.maxBytes) throw new M3UParseError("too_large");
    stats.lines += 1;
    const lineNumber = stats.lines;
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    start = hasNewline ? end + 1 : text.length;
    if (stats.lines % M3U_LIMITS.yieldEveryLines === 0) {
      await yieldControl();
      checkCancelled();
    }
    if (!line) continue;
    if (!headerSeen) {
      if (!/^#EXTM3U(?:\s|$)/i.test(line))
        throw new M3UParseError("missing_header");
      headerSeen = true;
      continue;
    }
    // Only tags that define an HLS media/master playlist reject the file;
    // stray #EXT-X-* lines in hand-edited channel directories are ignored.
    if (HLS_STRUCTURE_TAG.test(line)) throw new M3UParseError("hls_playlist");
    if (/^#EXTINF:/i.test(line)) {
      if (pending) addIssue(pending.line, "dangling_extinf");
      countEntry();
      pending = parseExtinf(line, lineNumber);
      if (!pending) addIssue(lineNumber, "invalid_extinf");
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!pending) {
      countEntry();
      addIssue(lineNumber, "missing_extinf");
      continue;
    }
    try {
      const streamUrl = normalizeRemoteUrl(line, baseUrl);
      candidates.push({ ...pending, streamUrl });
    } catch (error) {
      addIssue(
        lineNumber,
        error instanceof UrlValidationError ? error.code : "invalid_url",
      );
    }
    pending = null;
  }
  if (pending) addIssue(pending.line, "dangling_extinf");
  const idUrls = new Map<string, Set<string>>();
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (candidate.tvgId) {
      const urls = idUrls.get(candidate.tvgId) ?? new Set<string>();
      urls.add(candidate.streamUrl);
      idUrls.set(candidate.tvgId, urls);
    }
    if (i > 0 && i % M3U_LIMITS.yieldEveryLines === 0) {
      await yieldControl();
      checkCancelled();
    }
  }
  const identities = new Set<string>();
  const channels: ParsedChannel[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    // Exact normalized URLs avoid hash collisions and retain every authentication token.
    const identityKey =
      candidate.tvgId && idUrls.get(candidate.tvgId)?.size === 1
        ? `id:${candidate.tvgId}`
        : `url:${candidate.streamUrl}`;
    if (identities.has(identityKey)) addIssue(candidate.line, "duplicate");
    else {
      identities.add(identityKey);
      channels.push({
        identityKey,
        name: candidate.name,
        groupName: candidate.groupName,
        tvgId: candidate.tvgId,
        logoUrl: candidate.logoUrl,
        countries: candidate.countries,
        languages: candidate.languages,
        streamUrl: candidate.streamUrl,
        sortIndex: channels.length,
      });
      if (candidate.streamUrl.startsWith("http:")) stats.http += 1;
    }
    if (i > 0 && i % M3U_LIMITS.yieldEveryLines === 0) {
      await yieldControl();
      checkCancelled();
    }
  }
  checkCancelled();
  if (channels.length === 0) throw new M3UParseError("no_channels");
  stats.valid = channels.length;
  return { channels, stats, issues, issueCounts };
}
