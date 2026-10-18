import { ReadableStream } from "node:stream/web";
import { TextDecoder as NodeTextDecoder } from "node:util";
import { createHash } from "node:crypto";
import {
  decodeGbk,
  decodePlaylistBytes,
  TextEncodingError,
} from "../src/domain/textEncoding";
import { GBK_ROWS, GBK_TRAIL_COUNT } from "../src/domain/gbkTable";
import { M3UParseError, parseM3U } from "../src/domain/m3u";
import { looksLikeTxtPlaylist, parseTxtLine } from "../src/domain/txtPlaylist";
import { readBoundedStream } from "../src/data/importIO";

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: jest.fn() }));
Object.assign(globalThis, { TextDecoder: NodeTextDecoder });

const nodeGbk = new NodeTextDecoder("gbk", { fatal: true });
/** Every two-byte GBK code in table order, as [lead, trail]. */
const allPairs = (() => {
  const pairs: [number, number][] = [];
  for (let lead = 0x81; lead <= 0xfe; lead += 1)
    for (let trail = 0x40; trail <= 0xfe; trail += 1)
      if (trail !== 0x7f) pairs.push([lead, trail]);
  return pairs;
})();
/** Test-only encoder built from Node's decoder. */
const encodeGbk = (text: string): Uint8Array => {
  const reverse = new Map<string, [number, number]>();
  for (const pair of allPairs)
    reverse.set(nodeGbk.decode(new Uint8Array(pair)), pair);
  const bytes: number[] = [];
  for (const char of text) {
    if (char.charCodeAt(0) < 0x80) bytes.push(char.charCodeAt(0));
    else bytes.push(...reverse.get(char)!);
  }
  return new Uint8Array(bytes);
};

describe("GBK decoding", () => {
  it("decodes every two-byte code against the pinned WHATWG index", () => {
    expect(GBK_ROWS).toHaveLength(0xfe - 0x81 + 1);
    for (const row of GBK_ROWS) expect(row).toHaveLength(GBK_TRAIL_COUNT);
    const bytes = new Uint8Array(allPairs.flat());
    const reference = GBK_ROWS.join("");
    // Independently checked against WHATWG index-gb18030.txt (2024-09-18,
    // identifier ff1c9a923b5d24f9761b3a2de2c0f07b395f9f6f36519508944de4f0415be81c).
    // Older host ICU builds expose CP936 private-use aliases instead.
    expect(createHash("sha256").update(reference).digest("hex")).toBe(
      "85373408efe24c652c0a2f37997df8c657b0e8a654d07d9f9d97f1ad16609bc6",
    );
    expect(decodeGbk(bytes)).toBe(reference);
    expect(decodeGbk(new Uint8Array([0xa2, 0xe3, 0xa8, 0xbc]))).toBe("€ḿ");
  });

  it("keeps ASCII, maps 0x80 to the euro sign and decodes Chinese", () => {
    expect(
      decodeGbk(new Uint8Array([0x41, 0x80, 0xd6, 0xd0, 0xce, 0xc4])),
    ).toBe("A€中文");
  });

  it.each([
    ["a lone 0xFF", [0xff]],
    ["a truncated pair", [0x41, 0xd6]],
    ["a trail byte of 0x7F", [0xd6, 0x7f]],
    ["a GB18030 four-byte sequence", [0x81, 0x30, 0x81, 0x30]],
  ])("rejects %s instead of guessing", (_label, bytes) => {
    expect(() => decodeGbk(new Uint8Array(bytes))).toThrow(TextEncodingError);
  });

  it("prefers valid UTF-8 and falls back to GBK only when UTF-8 fails", () => {
    const utf8 = new TextEncoder().encode("﻿中文");
    expect(decodePlaylistBytes(utf8)).toEqual({
      text: "中文",
      encoding: "utf-8",
    });
    expect(decodePlaylistBytes(encodeGbk("中文"))).toEqual({
      text: "中文",
      encoding: "gbk",
    });
  });

  it("decodes a GBK playlist read through the import stream", async () => {
    const bytes = encodeGbk(
      "央视频道,#genre#\nCCTV-1,https://tv.example.com/1.m3u8\n",
    );
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 3));
        controller.enqueue(bytes.slice(3));
        controller.close();
      },
    }) as unknown as globalThis.ReadableStream<Uint8Array>;
    const text = await readBoundedStream(stream, new AbortController().signal);
    const result = await parseM3U(text);
    expect(result.channels[0]).toMatchObject({
      name: "CCTV-1",
      groupName: "央视频道",
    });
  });
});

describe("TXT channel lists", () => {
  it("reads groups, joined alternatives and line labels", async () => {
    const text = [
      "央视频道,#genre#",
      "CCTV-1,https://a.example.com/1.m3u8#https://b.example.com/1.m3u8",
      "CCTV-2,https://a.example.com/2.m3u8$线路一",
      "",
      "卫视频道,#genre#",
      "# a comment",
      "湖南卫视,https://a.example.com/hn.m3u8?token=x#frag",
    ].join("\r\n");
    const result = await parseM3U(text);
    expect(
      result.channels.map(({ name, groupName, streamUrl }) => [
        name,
        groupName,
        streamUrl,
      ]),
    ).toEqual([
      ["CCTV-1", "央视频道", "https://a.example.com/1.m3u8"],
      ["CCTV-1", "央视频道", "https://b.example.com/1.m3u8"],
      ["CCTV-2", "央视频道", "https://a.example.com/2.m3u8"],
      ["湖南卫视", "卫视频道", "https://a.example.com/hn.m3u8?token=x#frag"],
    ]);
    expect(result.channels[0]).toMatchObject({
      tvgId: null,
      countries: [],
      languages: [],
      identityKey: "url:https://a.example.com/1.m3u8",
    });
  });

  it("counts lines without an address and unsafe addresses as ignored", async () => {
    const result = await parseM3U(
      [
        "CCTV-1,https://a.example.com/1.m3u8",
        "没有地址的一行",
        "内网,http://192.168.1.1:4022/rtp/239.0.0.1:5000",
      ].join("\n"),
    );
    expect(result.stats).toMatchObject({ valid: 1, ignored: 2, total: 3 });
    expect(result.issueCounts).toEqual({ invalid_extinf: 1, unsafe_url: 1 });
  });

  it("parses single lines by kind", () => {
    expect(parseTxtLine("新闻,#genre#")).toEqual({
      kind: "group",
      name: "新闻",
    });
    expect(parseTxtLine("// note")).toEqual({ kind: "comment" });
    expect(parseTxtLine(",https://a.example.com/x")).toEqual({
      kind: "invalid",
    });
    expect(looksLikeTxtPlaylist("<html>not a playlist</html>")).toBe(false);
  });
});

describe("M3U without its header", () => {
  it("is read when #EXTINF lines show the format", async () => {
    const result = await parseM3U(
      '#EXTINF:-1 group-title="新闻",新闻台\nhttps://a.example.com/news.m3u8\n',
    );
    expect(result.channels[0]).toMatchObject({
      name: "新闻台",
      groupName: "新闻",
    });
  });

  it("still rejects text that is neither M3U nor TXT", async () => {
    await expect(parseM3U("just some words\nmore words")).rejects.toEqual(
      new M3UParseError("missing_header"),
    );
  });
});
