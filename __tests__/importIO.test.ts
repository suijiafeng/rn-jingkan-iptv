import { ReadableStream } from "node:stream/web";
import { TextDecoder, TextEncoder } from "node:util";
import { readBoundedStream, downloadPlaylist } from "../src/data/importIO";
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: jest.fn() }));
const { fetch: fetchMock } = jest.requireMock("expo/fetch");
Object.assign(globalThis, { TextDecoder, TextEncoder });
function stream(chunks: Uint8Array[]) {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  }) as unknown as globalThis.ReadableStream<Uint8Array>;
}
test("bounded stream reads multi-byte UTF8 split across chunks", async () => {
  const bytes = new TextEncoder().encode("中文目录");
  expect(
    await readBoundedStream(
      stream([bytes.slice(0, 2), bytes.slice(2)]),
      new AbortController().signal,
    ),
  ).toBe("中文目录");
});
test("bound uses actual bytes instead of server header", async () => {
  await expect(
    readBoundedStream(
      stream([new Uint8Array(10), new Uint8Array(10)]),
      new AbortController().signal,
      15,
    ),
  ).rejects.toThrow("超过");
});
test("invalid UTF8 is not silently replaced", async () => {
  await expect(
    readBoundedStream(
      stream([new Uint8Array([0xff])]),
      new AbortController().signal,
    ),
  ).rejects.toThrow("UTF-8");
});
test("revoked remote consent prevents fetch even for HTTPS", async () => {
  fetchMock.mockClear();
  await expect(
    downloadPlaylist(
      "https://example.com/list",
      new AbortController().signal,
      false,
    ),
  ).rejects.toThrow("尚未允许");
  expect(fetchMock).not.toHaveBeenCalled();
});
test("cancellation does not return partial data", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    readBoundedStream(stream([]), controller.signal),
  ).rejects.toThrow("取消");
});
