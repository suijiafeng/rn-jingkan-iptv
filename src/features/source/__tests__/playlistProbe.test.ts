import {
  audioLanguages,
  looksLikePlaylist,
  nextProbeStep,
} from "../playlistProbe";

test("playlists are recognised by MIME type or by their first line", () => {
  expect(looksLikePlaylist("application/vnd.apple.mpegURL", "")).toBe(true);
  expect(looksLikePlaylist("", "﻿  #EXTM3U\n")).toBe(true);
  expect(looksLikePlaylist("video/mp2t", "G@\u0011")).toBe(false);
});

test("a master playlist yields its first variant, a media playlist its first segment", () => {
  expect(
    nextProbeStep(
      '#EXTM3U\r\n#EXT-X-MEDIA:TYPE=AUDIO,URI="a.m3u8"\r\n#EXT-X-STREAM-INF:BANDWIDTH=1\r\n\r\nv1.m3u8\r\n',
      true,
    ),
  ).toEqual({ kind: "playlist", uri: "v1.m3u8" });
  expect(
    nextProbeStep(
      "#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:6,\n s1.ts \n",
      true,
    ),
  ).toEqual({ kind: "segment", uri: "s1.ts" });
});

test("an unfinished last line is ignored and an empty window yields nothing", () => {
  expect(nextProbeStep("#EXTM3U\n#EXTINF:6,\nseg1.t", false)).toBeNull();
  expect(nextProbeStep("#EXTM3U\n#EXTINF:6,\nseg1.ts", true)).toEqual({
    kind: "segment",
    uri: "seg1.ts",
  });
  expect(
    nextProbeStep("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n", true),
  ).toBeNull();
});

test("a master playlist states its audio languages; nothing else is read for language", () => {
  const master = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="国语",LANGUAGE="zh-CN",URI="zh.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="粤语",LANGUAGE="yue",URI="yue.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Chinese",LANGUAGE="zho",URI="z2.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English",LANGUAGE="en",URI="en.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="a"',
    "v.m3u8",
    "",
  ].join("\n");
  // Subtitles, names and undeclared tracks never count; zh-CN and zho are zh.
  expect(audioLanguages(master, true)).toEqual(["zh", "yue"]);
  expect(
    audioLanguages("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n", true),
  ).toEqual([]);
  // A media playlist says nothing about language.
  expect(audioLanguages("#EXTM3U\n#EXTINF:6,\nseg.ts\n", true)).toBeNull();
  // A tag cut off by the read limit is dropped.
  expect(
    audioLanguages(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="en',
      false,
    ),
  ).toEqual([]);
});
