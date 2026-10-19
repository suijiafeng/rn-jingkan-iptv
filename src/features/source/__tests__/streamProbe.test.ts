import {
  CHECK_RETRY_DELAY_MS,
  CHECK_TIMEOUT_MS,
  checkStream,
} from "../streamProbe";

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
const { fetch: fetchMock } = jest.requireMock("expo/fetch");
const signal = () => new AbortController().signal;

beforeEach(() => fetchMock.mockReset());

/** A fetch response whose body is delivered as one chunk. */
function reply(
  status: number,
  text = "",
  extra: { mime?: string; url?: string } = {},
) {
  const cancel = jest.fn(() => Promise.resolve());
  const chunks = [new TextEncoder().encode(text)];
  return {
    status,
    ok: status >= 200 && status < 300,
    url: extra.url ?? "",
    headers: { get: () => extra.mime ?? null },
    cancel,
    body: {
      cancel,
      getReader: () => ({
        read: async () =>
          chunks.length
            ? { done: false, value: chunks.shift()! }
            : { done: true, value: undefined },
        cancel,
      }),
    },
  };
}
const requested = () =>
  fetchMock.mock.calls.map(
    ([url, init]: [string, { headers?: Record<string, string> }]) =>
      `${url}${init.headers?.Range ? " (range)" : ""}`,
  );

test("a success status counts as reachable; error statuses are not retried", async () => {
  const ok = reply(206, "binary");
  fetchMock.mockResolvedValueOnce(ok);
  await expect(checkStream("https://a.example.com/x", signal())).resolves.toBe(
    true,
  );
  expect(fetchMock.mock.calls[0][1].headers).toEqual({ Range: "bytes=0-1023" });
  expect(ok.cancel).toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(reply(403));
  await expect(checkStream("https://a.example.com/x", signal())).resolves.toBe(
    false,
  );
  fetchMock.mockResolvedValueOnce(reply(404));
  await expect(checkStream("https://a.example.com/x", signal())).resolves.toBe(
    false,
  );
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test("a server rejecting Range with 416 is asked once without it", async () => {
  fetchMock
    .mockResolvedValueOnce(reply(416))
    .mockResolvedValueOnce(reply(200, "binary"));
  await expect(
    checkStream("https://a.example.com/x.ts", signal()),
  ).resolves.toBe(true);
  expect(requested()).toEqual([
    "https://a.example.com/x.ts (range)",
    "https://a.example.com/x.ts",
  ]);
});

test("temporary statuses are retried once like network errors", async () => {
  jest.useFakeTimers();
  try {
    for (const status of [408, 429, 503]) {
      fetchMock
        .mockReset()
        .mockResolvedValueOnce(reply(status))
        .mockResolvedValueOnce(reply(206, "binary"));
      const pending = checkStream("https://a.example.com/x", signal());
      await jest.advanceTimersByTimeAsync(CHECK_RETRY_DELAY_MS);
      await expect(pending).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  } finally {
    jest.useRealTimers();
  }
});

test("an HLS master playlist is followed to its first variant and first segment", async () => {
  const master =
    "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8?t=1\n#EXT-X-STREAM-INF:BANDWIDTH=3000000\nhigh/index.m3u8\n";
  const media = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg1.ts\n";
  fetchMock
    .mockResolvedValueOnce(
      reply(200, master, { url: "https://cdn.example.com/live/master.m3u8" }),
    )
    .mockResolvedValueOnce(reply(200, media))
    .mockResolvedValueOnce(reply(206, "binary"));
  await expect(
    checkStream("https://a.example.com/live.m3u8", signal()),
  ).resolves.toBe(true);
  // Relative addresses resolve against the final, redirected playlist URL.
  expect(requested()).toEqual([
    "https://a.example.com/live.m3u8 (range)",
    "https://cdn.example.com/live/low/index.m3u8?t=1 (range)",
    "https://cdn.example.com/live/low/seg1.ts (range)",
  ]);
});

test("a playlist cut off by Range is read again in full before following it", async () => {
  const media = `#EXTM3U\n${"#EXT-X-PROGRAM-DATE-TIME:2026-10-19T00:00:00Z\n".repeat(30)}#EXTINF:6,\nseg1.ts\n`;
  fetchMock
    .mockResolvedValueOnce(
      reply(206, media.slice(0, 1024), {
        mime: "application/vnd.apple.mpegurl",
      }),
    )
    .mockResolvedValueOnce(reply(200, media))
    .mockResolvedValueOnce(reply(206, "binary"));
  await expect(
    checkStream("https://a.example.com/live.m3u8", signal()),
  ).resolves.toBe(true);
  expect(requested()).toEqual([
    "https://a.example.com/live.m3u8 (range)",
    "https://a.example.com/live.m3u8",
    "https://a.example.com/seg1.ts (range)",
  ]);
});

test("a playlist whose segment is gone counts as unreachable", async () => {
  fetchMock
    .mockResolvedValueOnce(reply(200, "#EXTM3U\n#EXTINF:6,\nseg1.ts\n"))
    .mockResolvedValueOnce(reply(404));
  await expect(
    checkStream("https://a.example.com/live.m3u8", signal()),
  ).resolves.toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("an empty live window or a private segment host stops at the playlist", async () => {
  fetchMock.mockResolvedValueOnce(
    reply(200, "#EXTM3U\n#EXT-X-TARGETDURATION:6\n"),
  );
  await expect(
    checkStream("https://a.example.com/live.m3u8", signal()),
  ).resolves.toBe(true);
  fetchMock.mockResolvedValueOnce(
    reply(200, "#EXTM3U\n#EXTINF:6,\nhttp://192.168.1.2/seg1.ts\n"),
  );
  await expect(
    checkStream("https://a.example.com/live.m3u8", signal()),
  ).resolves.toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("a network error is retried once after a pause", async () => {
  jest.useFakeTimers();
  try {
    fetchMock
      .mockRejectedValueOnce(new Error("reset"))
      .mockResolvedValueOnce(reply(206, "binary"));
    const pending = checkStream("https://a.example.com/x", signal());
    await jest.advanceTimersByTimeAsync(CHECK_RETRY_DELAY_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset().mockRejectedValue(new Error("offline"));
    const twice = checkStream("https://a.example.com/x", signal());
    await jest.advanceTimersByTimeAsync(CHECK_RETRY_DELAY_MS);
    await expect(twice).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test("stopping during the retry pause sends no second request", async () => {
  jest.useFakeTimers();
  try {
    const owner = new AbortController();
    fetchMock.mockRejectedValueOnce(new Error("reset"));
    const pending = checkStream("https://a.example.com/x", owner.signal);
    await jest.advanceTimersByTimeAsync(0);
    owner.abort();
    await expect(pending).resolves.toBe(false);
    await jest.advanceTimersByTimeAsync(CHECK_RETRY_DELAY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test("a stalled server is retried once and then reported unreachable", async () => {
  jest.useFakeTimers();
  try {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    );
    const pending = checkStream("https://a.example.com/slow", signal());
    await jest.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(CHECK_RETRY_DELAY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    await expect(pending).resolves.toBe(false);
  } finally {
    jest.useRealTimers();
  }
});
