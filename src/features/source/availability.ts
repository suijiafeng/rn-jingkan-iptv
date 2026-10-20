import { probeStream, type StreamCheck } from "./streamProbe";

export const CHECK_CONCURRENCY = 4;
/** A manual sweep on Wi-Fi or Ethernet runs twice as many probes at once. */
export const UNMETERED_CHECK_CONCURRENCY = 8;

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
  /** Audio languages the stream declared; absent when it said nothing. */
  languages?: string[];
}

/** Bounded-concurrency sweep; stopping returns only the finished results. */
export async function checkChannels(
  targets: CheckTarget[],
  options: {
    signal: AbortSignal;
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
    /** Each result as it lands; the same object ends up in the returned list. */
    onResult?: (result: CheckResult) => void;
    check?: (
      url: string,
      signal: AbortSignal,
    ) => Promise<boolean | StreamCheck>;
  },
): Promise<CheckResult[]> {
  const check = options.check ?? probeStream;
  const results: CheckResult[] = [];
  let next = 0;
  const worker = async () => {
    while (!options.signal.aborted && next < targets.length) {
      const target = targets[next++];
      const answer = await check(target.streamUrl, options.signal);
      if (options.signal.aborted) return;
      const { ok, languages } =
        typeof answer === "boolean"
          ? { ok: answer, languages: undefined }
          : answer;
      const result: CheckResult = {
        channelId: target.id,
        streamUrl: target.streamUrl,
        ok,
        ...(languages ? { languages } : {}),
      };
      results.push(result);
      options.onResult?.(result);
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
