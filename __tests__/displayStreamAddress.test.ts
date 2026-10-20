import { displayStreamAddress } from "../src/domain/url";

test("a stream address shows in full up to its query", () => {
  expect(displayStreamAddress("https://cdn.example.test/live/cctv1.m3u8")).toBe(
    "https://cdn.example.test/live/cctv1.m3u8",
  );
  expect(
    displayStreamAddress("https://cdn.example.test/live.m3u8?token=secret&u=1"),
  ).toBe("https://cdn.example.test/live.m3u8?…");
  expect(displayStreamAddress("http://example.test:8080/a.ts#t=secret")).toBe(
    "http://example.test:8080/a.ts?…",
  );
});
