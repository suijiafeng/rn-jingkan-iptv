import { checkStream } from "./streamProbe";

export const CHECK_CONCURRENCY = 4;

export interface CheckTarget {
  id: string;
  streamUrl: string;
}
/** A running manual sweep, as the source manager shows it. */
export interface CheckProgress {
  sourceId: string;
  done: number;
  /** Null while the repository is loading the complete, ungrouped target set. */
  total: number | null;
}
export interface CheckSummary {
  ok: number;
  unreachable: number;
  stopped: boolean;
}
export interface CheckResult {
  channelId: string;
  streamUrl: string;
  ok: boolean;
}

/** Bounded-concurrency sweep; stopping returns only the finished results. */
export async function checkChannels(
  targets: CheckTarget[],
  options: {
    signal: AbortSignal;
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
    check?: (url: string, signal: AbortSignal) => Promise<boolean>;
  },
): Promise<CheckResult[]> {
  const check = options.check ?? checkStream;
  const results: CheckResult[] = [];
  let next = 0;
  const worker = async () => {
    while (!options.signal.aborted && next < targets.length) {
      const target = targets[next++];
      const ok = await check(target.streamUrl, options.signal);
      if (options.signal.aborted) return;
      results.push({ channelId: target.id, streamUrl: target.streamUrl, ok });
      options.onProgress?.(results.length, targets.length);
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          options.concurrency ?? CHECK_CONCURRENCY,
          targets.length,
        ),
      },
      worker,
    ),
  );
  return results;
}
