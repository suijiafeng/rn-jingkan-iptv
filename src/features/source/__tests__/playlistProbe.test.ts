import { looksLikePlaylist, nextProbeStep } from "../playlistProbe";

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
