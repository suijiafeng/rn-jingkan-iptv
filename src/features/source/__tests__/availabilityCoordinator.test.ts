import { checkChannels } from "../availability";
import {
  checkAvailability,
  CHECK_FRESH_MS,
  type CheckStore,
} from "../availabilityCoordinator";
import type { StoredCheck } from "../../../data/availability";

jest.mock("../availability", () => ({ checkChannels: jest.fn() }));
const probe = checkChannels as jest.Mock;
const alpha = { id: "a", streamUrl: "https://example.com/a" };
const beta = { id: "b", streamUrl: "https://example.com/b" };
const options = () => ({
  signal: new AbortController().signal,
  isPermitted: () => true,
});
function store(initial: StoredCheck[] = []): CheckStore {
  const rows = new Map(initial.map((row) => [row.streamUrl, row]));
  return {
    getCheckResults: jest.fn(async (urls) =>
      urls.flatMap((url) => (rows.has(url) ? [rows.get(url)!] : [])),
    ),
    saveCheckResults: jest.fn(async (results) => {
      for (const result of results)
        rows.set(result.streamUrl, {
          streamUrl: result.streamUrl,
          checkStatus: result.ok ? "ok" : "unreachable",
          checkedAt: Date.now(),
        });
    }),
  };
}
beforeEach(() => {
  probe.mockReset().mockImplementation(async (targets) =>
    targets.map((row: typeof alpha) => ({
      channelId: row.id,
      streamUrl: row.streamUrl,
      ok: true,
    })),
  );
});

test("URLs, not rows or channel names, are deduplicated with a stable unique progress total", async () => {
  const progress = jest.fn();
  const result = await checkAvailability(
    store(),
    [alpha, { ...alpha, id: "other-source" }, beta],
    { ...options(), onProgress: progress },
  );
  expect(probe.mock.calls[0][0]).toHaveLength(2);
  expect(result.results).toHaveLength(2);
  expect(progress).toHaveBeenCalledWith(0, 2);
});

test("a fresh failed result is shared too; only an explicit force or expiry probes again", async () => {
  const db = store([
    {
      streamUrl: alpha.streamUrl,
      checkStatus: "unreachable",
      checkedAt: Date.now(),
    },
  ]);
  const cached = await checkAvailability(db, [alpha], options());
  expect(cached).toMatchObject({ refreshed: false, results: [{ ok: false }] });
  expect(probe).not.toHaveBeenCalled();
  expect(db.saveCheckResults).not.toHaveBeenCalled();
  await checkAvailability(db, [alpha], { ...options(), force: true });
  expect(probe).toHaveBeenCalledTimes(1);
  const expired = store([
    {
      streamUrl: alpha.streamUrl,
      checkStatus: "ok",
      checkedAt: Date.now() - CHECK_FRESH_MS,
    },
  ]);
  await checkAvailability(expired, [alpha], options());
  expect(probe).toHaveBeenCalledTimes(2);
});

test("overlapping entry points wait for the shared save and never repeat the same request", async () => {
  const db = store();
  let finish!: (value: unknown) => void;
  probe.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = checkAvailability(db, [alpha], options());
  const second = checkAvailability(db, [{ ...alpha, id: "other" }], options());
  for (let turn = 0; turn < 10 && !finish; turn++) await Promise.resolve();
  expect(probe).toHaveBeenCalledTimes(1);
  finish([{ channelId: alpha.id, streamUrl: alpha.streamUrl, ok: true }]);
  const [one, two] = await Promise.all([first, second]);
  expect(one.refreshed).toBe(true);
  expect(two.refreshed).toBe(false);
  expect(probe).toHaveBeenCalledTimes(1);
});

test("a cancelled queued job never probes, and revocation prevents persistence", async () => {
  const db = store();
  const abort = new AbortController();
  abort.abort();
  await checkAvailability(db, [alpha], { ...options(), signal: abort.signal });
  expect(probe).not.toHaveBeenCalled();
  let permitted = true;
  probe.mockImplementationOnce(async () => {
    permitted = false;
    return [{ channelId: alpha.id, streamUrl: alpha.streamUrl, ok: true }];
  });
  await checkAvailability(db, [alpha], {
    ...options(),
    isPermitted: () => permitted,
  });
  expect(db.saveCheckResults).not.toHaveBeenCalled();
});

test("save failures are reported and release the queue for a later explicit retry", async () => {
  const db = store();
  (db.saveCheckResults as jest.Mock).mockRejectedValueOnce(
    new Error("disk full"),
  );
  await expect(checkAvailability(db, [alpha], options())).rejects.toThrow(
    "检测结果未能保存",
  );
  await expect(checkAvailability(db, [beta], options())).resolves.toMatchObject(
    {
      refreshed: true,
    },
  );
});

test("the automatic limit is applied after global cache reuse", async () => {
  const db = store([
    { streamUrl: alpha.streamUrl, checkStatus: "ok", checkedAt: Date.now() },
  ]);
  await checkAvailability(
    db,
    [alpha, beta, { id: "c", streamUrl: "https://example.com/c" }],
    { ...options(), maxRequests: 1 },
  );
  expect(probe.mock.calls[0][0]).toEqual([beta]);
});

test("cached reads never run a network preflight; a cancelled preflight does not block the next caller", async () => {
  const db = store([
    { streamUrl: alpha.streamUrl, checkStatus: "ok", checkedAt: Date.now() },
  ]);
  const beforeRequests = jest.fn(async () => true);
  await checkAvailability(db, [alpha], { ...options(), beforeRequests });
  expect(beforeRequests).not.toHaveBeenCalled();
  const owner = new AbortController();
  let begin!: () => void;
  const begun = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const first = checkAvailability(db, [beta], {
    ...options(),
    signal: owner.signal,
    beforeRequests: () => {
      begin();
      return new Promise(() => {});
    },
  });
  await begun;
  owner.abort();
  await first;
  await expect(checkAvailability(db, [beta], options())).resolves.toMatchObject(
    { refreshed: true },
  );
});
