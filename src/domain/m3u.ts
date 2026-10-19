import type {
  ImportIssue,
  ImportIssueReason,
  ImportPreview,
  ParsedChannel,
} from "./types";
import { normalizeRemoteUrl, UrlValidationError } from "./url";
import { normalizeGroups } from "./channelLabels";
import {
  countryFromIptvOrgId,
  normalizeCountries,
  normalizeLanguages,
} from "./channelFacets";
import { parseDeclaredQuality, qualityFromIptvOrgId } from "./channelSources";
import { looksLikeTxtPlaylist, parseTxtLine } from "./txtPlaylist";

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
        missing_header:
          "无法识别节目单格式，请使用 M3U 或“频道名,地址”格式的 TXT。",
        invalid_encoding: "无法识别文件编码，请另存为 UTF-8 后导入。",
        too_large: `节目单超过 ${MAX_MIB} MB，请拆分后导入。`,
        line_too_long: "节目单中有过长的行，无法导入。",
        too_many_entries: "节目单超过 20,000 条，请拆分后导入。",
        hls_playlist: "这是单个频道的播放地址，请改用节目单链接。",
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
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0xfffd) throw new M3UParseError("invalid_encoding");
    if (code < 0x80) length += 1;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(++index);
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
  qualityLabel: string | null;
  qualityRank: number | null;
  line: number;
}
interface Candidate extends PendingChannel {
  streamUrl: string;
}

function parseExtinf(line: string, lineNumber: number): PendingChannel | null {
  let quote = "";
  let comma = -1;
  for (let position = 8; position < line.length; position += 1) {
    const char = line[position];
    if (
      (char === '"' || char === "'") &&
      (position === 0 || line[position - 1] !== "\\")
    ) {
      if (!quote) quote = char;
      else if (quote === char) quote = "";
    }
    if (char === "," && !quote) {
      comma = position;
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
  const tvgId = attributes["tvg-id"] || null;
  const quality =
    parseDeclaredQuality(
      attributes["tvg-quality"] ||
        attributes["video-quality"] ||
        attributes.resolution ||
        attributes.quality,
    ) ?? qualityFromIptvOrgId(tvgId);
  return {
    name:
      line.slice(comma + 1).trim() || attributes["tvg-name"] || "未命名频道",
    groupName: normalizeGroups(attributes["group-title"]),
    tvgId,
    // Loading remote artwork requires a separate informed application consent.
    logoUrl: attributes["tvg-logo"] || null,
    // Explicit attributes win; otherwise only an iptv-org formatted tvg-id
    // (its lists no longer carry tvg-country) supplies the country.
    countries: ((explicit) =>
      explicit.length ? explicit : countryFromIptvOrgId(attributes["tvg-id"]))(
      normalizeCountries(attributes["tvg-country"] || attributes.country),
    ),
    languages: normalizeLanguages(
      attributes["tvg-language"] || attributes.language,
    ),
    qualityLabel: quality?.label ?? null,
    qualityRank: quality?.rank ?? null,
    line: lineNumber,
  };
}

const M3U_HEADER = /^#EXTM3U(?:\s|$)/i;

/**
 * M3U with or without its #EXTM3U header (the header is only optional when
 * #EXTINF lines show the format), otherwise the TXT channel list.
 */
function detectFormat(text: string): "m3u" | "txt" {
  const firstLine = text
    .replace(/^\uFEFF/, "")
    .trimStart()
    .split("\n", 1)[0];
  if (M3U_HEADER.test(firstLine.trim()) || /^\s*#EXTINF:/im.test(text))
    return "m3u";
  if (looksLikeTxtPlaylist(text)) return "txt";
  throw new M3UParseError("missing_header");
}

/**
 * Bounded text parser for M3U and TXT channel lists, not a streaming
 * downloader. No network requests are made.
 */
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
  const format = detectFormat(text);
  let pending: PendingChannel | null = null;
  let headerSeen = false;
  // TXT: the group named by the latest "名称,#genre#" line.
  let txtGroup = normalizeGroups(undefined);
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
  const addCandidate = (
    channel: PendingChannel,
    address: string,
    lineNumber: number,
  ) => {
    try {
      const streamUrl = normalizeRemoteUrl(address, baseUrl);
      candidates.push({ ...channel, streamUrl });
    } catch (error) {
      addIssue(
        lineNumber,
        error instanceof UrlValidationError ? error.code : "invalid_url",
      );
    }
  };
  const readTxtLine = (line: string, lineNumber: number) => {
    const parsed = parseTxtLine(line);
    if (parsed.kind === "comment") return;
    if (parsed.kind === "group") {
      txtGroup = normalizeGroups(parsed.name);
      return;
    }
    if (parsed.kind === "invalid") {
      countEntry();
      addIssue(lineNumber, "invalid_extinf");
      return;
    }
    // TXT carries no tvg-id or metadata, so every address is its own entry.
    for (const address of parsed.urls) {
      countEntry();
      addCandidate(
        {
          name: parsed.name,
          groupName: txtGroup,
          tvgId: null,
          logoUrl: null,
          countries: [],
          languages: [],
          qualityLabel: null,
          qualityRank: null,
          line: lineNumber,
        },
        address,
        lineNumber,
      );
    }
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
    if (format === "txt") {
      readTxtLine(line, lineNumber);
      continue;
    }
    if (!headerSeen && M3U_HEADER.test(line)) {
      headerSeen = true;
      continue;
    }
    headerSeen = true;
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
    addCandidate(pending, line, lineNumber);
    pending = null;
  }
  if (pending) addIssue(pending.line, "dangling_extinf");
  const idUrls = new Map<string, Set<string>>();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate.tvgId) {
      const urls = idUrls.get(candidate.tvgId) ?? new Set<string>();
      urls.add(candidate.streamUrl);
      idUrls.set(candidate.tvgId, urls);
    }
    if (index > 0 && index % M3U_LIMITS.yieldEveryLines === 0) {
      await yieldControl();
      checkCancelled();
    }
  }
  const identities = new Set<string>();
  const channels: ParsedChannel[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
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
        qualityLabel: candidate.qualityLabel,
        qualityRank: candidate.qualityRank,
        sortIndex: channels.length,
      });
      if (candidate.streamUrl.startsWith("http:")) stats.http += 1;
    }
    if (index > 0 && index % M3U_LIMITS.yieldEveryLines === 0) {
      await yieldControl();
      checkCancelled();
    }
  }
  checkCancelled();
  if (channels.length === 0) throw new M3UParseError("no_channels");
  stats.valid = channels.length;
  return { channels, stats, issues, issueCounts };
}
