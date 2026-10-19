/** A child signal that follows a parent and also fires after a time limit. */
export interface Deadline {
  readonly signal: AbortSignal;
  /** True only when the time limit, not the parent, ended the work. */
  readonly timedOut: boolean;
  /** Ends the work early, e.g. from a second, shorter timer. */
  abort(): void;
  /** Always call in `finally`: clears the timer and detaches from the parent. */
  close(): void;
}

export function linkedDeadline(
  parent: AbortSignal,
  milliseconds: number,
): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  parent.addEventListener("abort", abort);
  if (parent.aborted) abort();
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) timedOut = true;
    abort();
  }, milliseconds);
  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    abort,
    close() {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
      abort();
    },
  };
}

/** Waits, but returns at once when the signal fires. Never rejects. */
export function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done);
    if (signal.aborted) done();
  });
}

/**
 * Resolves with the task, or with undefined as soon as the signal fires, so a
 * cancelled caller is never held by a task it cannot stop (a system lookup, a
 * dialog). The task itself keeps running.
 */
export async function untilAborted<T>(
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
