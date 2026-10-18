import type { Repository } from "../../data/repository";
import {
  checkChannels,
  type CheckResult,
  type CheckTarget,
} from "./availability";

export const CHECK_FRESH_MS = 6 * 60 * 60 * 1000;
export type CheckStore = Pick<
  Repository,
  "getCheckResults" | "saveCheckResults"
>;
export class AvailabilitySaveError extends Error {
  constructor() {
    super("检测结果未能保存，请重试");
  }
}
interface Options {
  signal: AbortSignal;
  isPermitted: () => boolean;
  beforeRequests?: () => Promise<boolean>;
  force?: boolean;
  maxRequests?: number;
  onProgress?: (done: number, total: number) => void;
}

/** One queue per open database, shared by every UI entry point. */
const queues = new WeakMap<CheckStore, Promise<void>>();

/** A system network lookup or a consent dialog must not hold a cancelled job. */
async function cancellable<T>(
  task: Promise<T>,
  signal: AbortSignal,
): Promise<T | undefined> {
  let abort!: () => void;
  const cancelled = new Promise<undefined>((resolve) => {
    abort = () => resolve(undefined);
    signal.addEventListener("abort", abort);
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([task, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

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
    const now = Date.now();
    const cached = new Map(
      stored
        .filter(
          (entry) =>
            entry.checkedAt <= now && now - entry.checkedAt < CHECK_FRESH_MS,
        )
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
      (!(await cancellable(
        options.beforeRequests?.() ?? Promise.resolve(true),
        options.signal,
      )) ||
        options.signal.aborted ||
        !options.isPermitted())
    )
      return { results: reused, refreshed: false, skipped: true };
    const checked = selected.length
      ? await checkChannels(selected, {
          signal: options.signal,
          onProgress: (done) =>
            options.onProgress?.(reused.length + done, total),
        })
      : [];
    // The queue is held through persistence. The next caller reads SQLite
    // after this commit rather than racing a second request against the save.
    if (!options.isPermitted()) return { results: [], refreshed: false };
    if (checked.length) {
      try {
        await store.saveCheckResults(checked);
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
