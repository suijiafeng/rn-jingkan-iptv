import { GBK_ROWS, GBK_TRAIL_COUNT } from "./gbkTable";

export type PlaylistEncoding = "utf-8" | "gbk";

export class TextEncodingError extends Error {
  constructor() {
    super("无法识别文件编码，请另存为 UTF-8 后导入");
    this.name = "TextEncodingError";
  }
}

/** Characters are collected in slices so a large file never builds one huge argument list. */
const SLICE_LENGTH = 8192;

/**
 * Strict GBK (the WHATWG two-byte form, plus 0x80 as "€"). Any byte pair
 * outside the table, a truncated pair, or a GB18030 four-byte sequence fails
 * instead of producing replacement characters.
 */
export function decodeGbk(bytes: Uint8Array): string {
  const parts: string[] = [];
  const codes = new Uint16Array(SLICE_LENGTH);
  let filled = 0;
  const flush = () => {
    parts.push(String.fromCharCode(...codes.subarray(0, filled)));
    filled = 0;
  };
  for (let position = 0; position < bytes.length; position += 1) {
    const lead = bytes[position];
    let code: number;
    if (lead < 0x80) code = lead;
    else if (lead === 0x80) code = 0x20ac;
    else if (lead === 0xff) throw new TextEncodingError();
    else {
      const trail = bytes[position + 1];
      if (trail === undefined || trail < 0x40 || trail === 0x7f || trail > 0xfe)
        throw new TextEncodingError();
      const column = trail < 0x7f ? trail - 0x40 : trail - 0x41;
      if (column >= GBK_TRAIL_COUNT) throw new TextEncodingError();
      code = GBK_ROWS[lead - 0x81].charCodeAt(column);
      position += 1;
    }
    codes[filled] = code;
    filled += 1;
    if (filled === SLICE_LENGTH) flush();
  }
  if (filled) flush();
  return parts.join("");
}

/**
 * Playlist text from raw bytes: UTF-8 (with or without BOM) when it is
 * valid, otherwise GBK, which many Chinese TXT and M3U lists still use.
 */
export function decodePlaylistBytes(bytes: Uint8Array): {
  text: string;
  encoding: PlaylistEncoding;
} {
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      encoding: "utf-8",
    };
  } catch {
    return { text: decodeGbk(bytes), encoding: "gbk" };
  }
}
