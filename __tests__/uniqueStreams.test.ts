import { uniqueStreams } from "../src/domain/channelSources";

const row = (id: string, streamUrl: string) => ({ id, streamUrl });

test("the same address from two playlists is listed once, in order", () => {
  const sources = [
    row("a", "https://x.test/1.m3u8"),
    row("b", "https://x.test/2.m3u8"),
    row("c", "https://x.test/1.m3u8"),
  ];
  expect(uniqueStreams(sources).map((source) => source.id)).toEqual(["a", "b"]);
});

test("the playing row is the one kept for its address", () => {
  const sources = [
    row("a", "https://x.test/1.m3u8"),
    row("b", "https://x.test/2.m3u8"),
    row("c", "https://x.test/1.m3u8"),
  ];
  expect(uniqueStreams(sources, "c").map((source) => source.id)).toEqual([
    "c",
    "b",
  ]);
});

test("addresses that differ only in their token stay apart", () => {
  const sources = [
    row("a", "https://x.test/1.m3u8?token=one"),
    row("b", "https://x.test/1.m3u8?token=two"),
  ];
  expect(uniqueStreams(sources)).toHaveLength(2);
});
