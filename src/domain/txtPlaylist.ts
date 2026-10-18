/**
 * The TXT channel list common in Chinese IPTV apps (DIYP / TVBox style):
 *
 *   央视频道,#genre#
 *   CCTV-1,http://example.com/cctv1.m3u8
 *   CCTV-1,http://a.example.com/1.m3u8#http://b.example.com/1.m3u8
 *   CCTV-2,http://example.com/cctv2.m3u8$线路一
 *
 * A "名称,#genre#" line starts a group. A channel line is "名称,地址";
 * several addresses may be joined by "#", and a trailing "$备注" names the
 * line and is not part of the address.
 */
export type TxtLine =
  | { kind: "group"; name: string }
  | { kind: "channel"; name: string; urls: string[] }
  | { kind: "comment" }
  | { kind: "invalid" };

const GENRE_MARK = /^#genre#$/i;
/** "#" that starts another absolute address, not a URL fragment. */
const ALTERNATIVE_SEPARATOR = /#(?=[a-z][a-z0-9+.-]*:\/\/)/i;
/** "$label" at the end, when the label cannot be part of a path or query. */
const LINE_LABEL = /\$[^/?=&]*$/;
/** A channel line: a name, a comma, then something with a scheme. */
const CHANNEL_LINE = /^[^#,\n][^,\n]*,\s*[a-z][a-z0-9+.-]*:\/\//im;
const GENRE_LINE = /^[^,\n]+,\s*#genre#\s*$/im;

/** True when the text reads as a TXT channel list rather than M3U. */
export function looksLikeTxtPlaylist(text: string): boolean {
  return CHANNEL_LINE.test(text) || GENRE_LINE.test(text);
}

export function parseTxtLine(line: string): TxtLine {
  if (line.startsWith("#") || line.startsWith("//")) return { kind: "comment" };
  const comma = line.indexOf(",");
  if (comma <= 0) return { kind: "invalid" };
  const name = line.slice(0, comma).trim();
  const rest = line.slice(comma + 1).trim();
  if (!name) return { kind: "invalid" };
  if (GENRE_MARK.test(rest)) return { kind: "group", name };
  const urls = rest
    .split(ALTERNATIVE_SEPARATOR)
    .map((address) => address.replace(LINE_LABEL, "").trim())
    .filter(Boolean);
  return urls.length ? { kind: "channel", name, urls } : { kind: "invalid" };
}
