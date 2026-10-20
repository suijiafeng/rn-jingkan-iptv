import type { StoredCheck } from "../../data/availability";
import { untilAborted } from "../../lib/abort";
import type { Repository } from "../../data/repository";
import {
  checkChannels,
  type CheckResult,
  type CheckTarget,
} from "./availability";

export type CheckStore = Pick<
  Repository,
  "getCheckResults" | "saveCheckResults"
>;
export class AvailabilitySaveError extends Error {
  constructor() {
    super("测试结果未保存，可重新测试");
  }
}
interface Options {
  signal: AbortSignal;
  isPermitted: () => boolean;
  beforeRequests?: () => Promise<boolean>;
  force?: boolean;
  maxRequests?: number;
  /**
   * Probes at once, read after beforeRequests passes; the caller picks it
   * from the network type it saw there.
   */
  concurrency?: () => number;
  onProgress?: (done: number, total: number) => void;
  /** Clock for result freshness; tests inject a fixed time. */
  now?: () => number;
}

/** A reachable address is trusted for a day before it is probed again. */
export const OK_RESULT_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Failures are often transient (server restart, token rotation), and an
 * unreachable mark sorts the channel last and skips it while zapping, so it
 * expires sooner.
 */
export const UNREACHABLE_RESULT_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Results are written every this many, so a sweep the system kills midway
 * keeps what it finished and the next run starts from the rest.
 */
export const CHECK_SAVE_BATCH = 100;

/** A clock that moved backwards makes the age unknown: probe again. */
function isFresh(entry: StoredCheck, now: number): boolean {
  const age = now - entry.checkedAt;
  const ttl =
    entry.checkStatus === "ok" ? OK_RESULT_TTL_MS : UNREACHABLE_RESULT_TTL_MS;
  return age >= 0 && age < ttl;
}

/** One queue per open database, shared by every UI entry point. */
const queues = new WeakMap<CheckStore, Promise<void>>();

export async function checkAvailability(
  store: CheckStore,
  targets: readonly CheckTarget[],
  options: Options,
): Promise<{ results: CheckResult[]; refreshed: boolean; skipped?: boolean }> {
  const previous = queues.get(store) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(store, tail);
  await previous;
  try {
    if (options.signal.aborted || !options.isPermitted())
      return { results: [], refreshed: false };
    const unique = [
      ...new Map(targets.map((target) => [target.streamUrl, target])).values(),
    ];
    const stored = await store.getCheckResults(
      unique.map((target) => target.streamUrl),
    );
    if (options.signal.aborted || !options.isPermitted())
      return { results: [], refreshed: false };
    // Fresh persisted results are reused; expired ones and an explicit forced
    // check probe again.
    const now = (options.now ?? Date.now)();
    const cached = new Map(
      stored
        .filter((entry) => isFresh(entry, now))
        .map((entry) => [entry.streamUrl, entry]),
    );
    const reused: CheckResult[] = [];
    const pending: CheckTarget[] = [];
    for (const target of unique) {
      const entry = options.force ? undefined : cached.get(target.streamUrl);
      if (entry)
        reused.push({
          channelId: target.id,
          streamUrl: target.streamUrl,
          ok: entry.checkStatus === "ok",
        });
      else pending.push(target);
    }
    const selected = pending.slice(0, options.maxRequests ?? pending.length);
    const total = reused.length + selected.length;
    options.onProgress?.(reused.length, total);
    if (
      selected.length &&
      (!(await untilAborted(
        options.beforeRequests?.() ?? Promise.resolve(true),
        options.signal,
      )) ||
        options.signal.aborted ||
        !options.isPermitted())
    )
      return { results: reused, refreshed: false, skipped: true };
    // Batches are saved one after another while probing goes on; each save
    // checks permission when it runs, so nothing is written after revocation.
    const saved = new Set<CheckResult>();
    let unsaved: CheckResult[] = [],
      saving = Promise.resolve(),
      saveFailed = false;
    const save = (batch: CheckResult[]) => {
      saving = saving
        .then(async () => {
          if (saveFailed || !options.isPermitted()) return;
          await store.saveCheckResults(batch);
          for (const result of batch) saved.add(result);
        })
        .catch(() => {
          saveFailed = true;
        });
    };
    const checked = selected.length
      ? await checkChannels(selected, {
          signal: options.signal,
          concurrency: options.concurrency?.(),
          onResult: (result) => {
            unsaved.push(result);
            if (unsaved.length < CHECK_SAVE_BATCH) return;
            save(unsaved);
            unsaved = [];
          },
          onProgress: (done) =>
            options.onProgress?.(reused.length + done, total),
        })
      : [];
    // The queue is held through persistence. The next caller reads SQLite
    // after this commit rather than racing a second request against the save.
    await saving;
    if (saveFailed) throw new AvailabilitySaveError();
    if (!options.isPermitted()) return { results: [], refreshed: false };
    const rest = checked.filter((result) => !saved.has(result));
    if (rest.length) {
      try {
        await store.saveCheckResults(rest);
      } catch {
        throw new AvailabilitySaveError();
      }
    }
    return { results: [...reused, ...checked], refreshed: checked.length > 0 };
  } finally {
    release();
    if (queues.get(store) === tail) queues.delete(store);
  }
}
