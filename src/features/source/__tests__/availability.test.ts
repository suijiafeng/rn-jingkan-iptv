import { CHECK_TIMEOUT_MS, checkChannels, checkStream } from "../availability";

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
const { fetch: fetchMock } = jest.requireMock("expo/fetch");
const signal = () => new AbortController().signal;

beforeEach(() => fetchMock.mockReset());

test("a success status counts as reachable; errors and failures do not", async () => {
  const cancel = jest.fn(() => Promise.resolve());
  fetchMock.mockResolvedValueOnce({ ok: true, status: 206, body: { cancel } });
  await expect(checkStream("https://a.example.com/x", signal())).resolves.toBe(
    true,
  );
  expect(fetchMock.mock.calls[0][1].headers).toEqual({ Range: "bytes=0-1023" });
  expect(cancel).toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce({ ok: false, status: 403, body: null });
  await expect(checkStream("https://a.example.com/x", signal())).resolves.toBe(
    false,
  );
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  await expect(checkStream("https://a.example.com/x", signal())).resolves.toBe(
    false,
  );
});

test("a stalled server is reported unreachable after the timeout", async () => {
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
    jest.advanceTimersByTime(CHECK_TIMEOUT_MS);
    await expect(pending).resolves.toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test("sweeps with bounded concurrency and reports progress", async () => {
  let running = 0;
  let peak = 0;
  const check = jest.fn(async (url: string) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 1));
    running -= 1;
    return !url.endsWith("bad");
  });
  const progress: number[] = [];
  const targets = Array.from({ length: 10 }, (_, i) => ({
    id: `c${i}`,
    streamUrl: `https://a.example.com/${i === 3 ? "bad" : i}`,
  }));
  const results = await checkChannels(targets, {
    signal: signal(),
    concurrency: 3,
    check,
    onProgress: (done) => progress.push(done),
  });
  expect(peak).toBeLessThanOrEqual(3);
  expect(results).toHaveLength(10);
  expect(results.find((r) => r.channelId === "c3")?.ok).toBe(false);
  expect(progress[progress.length - 1]).toBe(10);
});

test("stopping keeps finished results and starts no new checks", async () => {
  const owner = new AbortController();
  const check = jest.fn(async () => {
    if (check.mock.calls.length === 2) owner.abort();
    return true;
  });
  const targets = Array.from({ length: 6 }, (_, i) => ({
    id: `c${i}`,
    streamUrl: `https://a.example.com/${i}`,
  }));
  const results = await checkChannels(targets, {
    signal: owner.signal,
    concurrency: 1,
    check,
  });
  expect(check).toHaveBeenCalledTimes(2);
  expect(results.map((r) => r.channelId)).toEqual(["c0"]);
});
