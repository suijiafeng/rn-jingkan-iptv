import { ReadableStream } from "node:stream/web";
import { TextDecoder, TextEncoder } from "node:util";
import {
  contentTypeFromHead,
  contentTypeFromPath,
  resolveContentType,
  SNIFF_TIMEOUT_MS,
} from "../streamFormat";

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
const { fetch: fetchMock } = jest.requireMock("expo/fetch");
Object.assign(globalThis, { TextDecoder, TextEncoder });

function response(
  body: string | Uint8Array[],
  init: { status?: number; type?: string } = {},
) {
  const chunks =
    typeof body === "string" ? [new TextEncoder().encode(body)] : body;
  const cancel = jest.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
    cancel,
  });
  return {
    cancel,
    value: {
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      headers: new Map([["content-type", init.type ?? "text/plain"]]),
      body: stream,
    },
  };
}
const signal = () => new AbortController().signal;

beforeEach(() => fetchMock.mockReset());

test("conclusive suffixes never touch the network", async () => {
  expect(contentTypeFromPath("http://a.example.com/live/cctv1.m3u8?t=1")).toBe(
    "hls",
  );
  expect(contentTypeFromPath("https://a.example.com/out/manifest.mpd")).toBe(
    "dash",
  );
  expect(contentTypeFromPath("https://a.example.com/clip.MP4")).toBe("auto");
  expect(contentTypeFromPath("https://a.example.com/163189/ch8")).toBeNull();
  await expect(
    resolveContentType("https://a.example.com/x/index.m3u8", signal()),
  ).resolves.toBe("hls");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("classifies the head of HLS and DASH documents, including BOM", () => {
  expect(contentTypeFromHead("﻿ \n#EXTM3U\n#EXT-X-VERSION:3")).toBe("hls");
  expect(
    contentTypeFromHead('<?xml version="1.0"?>\n<MPD xmlns="urn:mpeg:dash">'),
  ).toBe("dash");
  expect(contentTypeFromHead("G@\u0011binary-ts")).toBe("auto");
});

test("suffix-less HLS is probed with a 1 KiB range request and bounded read", async () => {
  const big = response([
    new TextEncoder().encode("#EXTM3U\n"),
    new Uint8Array(4096),
    new Uint8Array(4096),
  ]);
  fetchMock.mockResolvedValue(big.value);
  await expect(
    resolveContentType("https://cdn.example.com/163189/ch8", signal()),
  ).resolves.toBe("hls");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].headers).toEqual({ Range: "bytes=0-1023" });
});

test("content-type headers short-circuit HLS and DASH detection", async () => {
  fetchMock.mockResolvedValueOnce(
    response("", { type: "application/vnd.apple.mpegURL" }).value,
  );
  await expect(
    resolveContentType("https://a.example.com/live", signal()),
  ).resolves.toBe("hls");
  fetchMock.mockResolvedValueOnce(
    response("", { type: "application/dash+xml" }).value,
  );
  await expect(
    resolveContentType("https://a.example.com/live", signal()),
  ).resolves.toBe("dash");
});

test("errors, HTTP failures and unknown bodies fall back to auto", async () => {
  fetchMock.mockResolvedValueOnce(response("denied", { status: 403 }).value);
  await expect(
    resolveContentType("https://a.example.com/live", signal()),
  ).resolves.toBe("auto");
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  await expect(
    resolveContentType("https://a.example.com/live", signal()),
  ).resolves.toBe("auto");
  fetchMock.mockResolvedValueOnce(response("Gbinary").value);
  await expect(
    resolveContentType("https://a.example.com/live", signal()),
  ).resolves.toBe("auto");
});

test("a stalled probe gives up after its budget and cancellation aborts it", async () => {
  jest.useFakeTimers();
  try {
    let aborted: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          aborted = init.signal;
          init.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const pending = resolveContentType("https://a.example.com/live", signal());
    jest.advanceTimersByTime(SNIFF_TIMEOUT_MS);
    await expect(pending).resolves.toBe("auto");
    expect(aborted?.aborted).toBe(true);

    const owner = new AbortController();
    const cancelled = resolveContentType(
      "https://a.example.com/b",
      owner.signal,
    );
    owner.abort();
    await expect(cancelled).resolves.toBe("auto");
  } finally {
    jest.useRealTimers();
  }
});
