import { checkChannels } from "../availability";

const signal = () => new AbortController().signal;

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
  const targets = Array.from({ length: 10 }, (_unused, index) => ({
    id: `c${index}`,
    streamUrl: `https://a.example.com/${index === 3 ? "bad" : index}`,
  }));
  const results = await checkChannels(targets, {
    signal: signal(),
    concurrency: 3,
    check,
    onProgress: (done) => progress.push(done),
  });
  expect(peak).toBeLessThanOrEqual(3);
  expect(results).toHaveLength(10);
  expect(results.find((result) => result.channelId === "c3")?.ok).toBe(false);
  expect(progress[progress.length - 1]).toBe(10);
});

test("stopping keeps finished results and starts no new checks", async () => {
  const owner = new AbortController();
  const check = jest.fn(async () => {
    if (check.mock.calls.length === 2) owner.abort();
    return true;
  });
  const targets = Array.from({ length: 6 }, (_unused, index) => ({
    id: `c${index}`,
    streamUrl: `https://a.example.com/${index}`,
  }));
  const results = await checkChannels(targets, {
    signal: owner.signal,
    concurrency: 1,
    check,
  });
  expect(check).toHaveBeenCalledTimes(2);
  expect(results.map((result) => result.channelId)).toEqual(["c0"]);
});

test("each result is handed over as it lands, the same object as returned", async () => {
  const landed: unknown[] = [];
  const targets = Array.from({ length: 5 }, (_unused, index) => ({
    id: `c${index}`,
    streamUrl: `https://a.example.com/${index}`,
  }));
  const results = await checkChannels(targets, {
    signal: signal(),
    check: async () => true,
    onResult: (result) => landed.push(result),
  });
  expect(landed).toHaveLength(5);
  results.forEach((result, index) => expect(landed[index]).toBe(result));
});
