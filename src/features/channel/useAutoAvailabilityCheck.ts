import { useCallback, useEffect, useRef, useState } from "react";
import * as Network from "expo-network";
import type { Channel } from "../../domain/types";
import { isOffline, mightUseMobileData } from "../player/playbackController";
import { checkChannels, type CheckResult } from "../source/availability";

/** At most this many channels are checked per category switch. */
export const AUTO_CHECK_MAX = 200;
/** Channels checked more recently than this are not checked again. */
export const CHECK_FRESH_MS = 6 * 60 * 60 * 1000;

export interface AutoCheckOptions {
  /** Identifies the current category; null = no category selected. */
  filterKey: string | null;
  /** The whole result set for filterKey is loaded. */
  listComplete: boolean;
  channels: readonly Channel[];
  /** Pause while something else needs the network (e.g. playback). */
  paused: boolean;
  remoteAllowed: boolean;
  mobileWarning: boolean;
  mobileAccepted: boolean;
  save: (results: CheckResult[]) => Promise<void>;
  /** Called once after a finished (not cancelled) sweep, to re-sort. */
  onFinished: () => void;
}

/**
 * Background availability check after a category switch. Silent: it never
 * prompts; without consent, offline, or on an unconfirmed metered network it
 * simply does not run. A new category, playback, or cancel() stops it.
 */
export function useAutoAvailabilityCheck(options: AutoCheckOptions) {
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Attempts made this run: never re-check them within CHECK_FRESH_MS even if
  // saving failed, so a reload after the sweep cannot start another sweep.
  const attempted = useRef(new Map<string, number>());
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setProgress(null);
  }, []);
  const {
    filterKey,
    listComplete,
    paused,
    remoteAllowed,
    mobileWarning,
    mobileAccepted,
  } = options;
  useEffect(() => {
    if (filterKey === null || !listComplete || paused || !remoteAllowed) return;
    const now = Date.now();
    const targets = latest.current.channels
      .filter(
        (channel) =>
          channel.active &&
          (!channel.checkedAt || now - channel.checkedAt > CHECK_FRESH_MS) &&
          now - (attempted.current.get(channel.id) ?? 0) > CHECK_FRESH_MS,
      )
      .slice(0, AUTO_CHECK_MAX);
    if (!targets.length) return;
    const abortController = new AbortController();
    controller.current?.abort();
    controller.current = abortController;
    const run = async () => {
      const net = await Network.getNetworkStateAsync();
      if (abortController.signal.aborted || isOffline(net)) return;
      if (mobileWarning && !mobileAccepted && mightUseMobileData(net)) return;
      for (const target of targets) attempted.current.set(target.id, now);
      setProgress({ done: 0, total: targets.length });
      const results = await checkChannels(targets, {
        signal: abortController.signal,
        onProgress: (done, total) => {
          if (!abortController.signal.aborted) setProgress({ done, total });
        },
      });
      if (results.length) await latest.current.save(results);
      // Re-sort once at the end, not under the user's finger mid-check.
      if (!abortController.signal.aborted) latest.current.onFinished();
    };
    run()
      .catch(() => {})
      .finally(() => {
        if (controller.current === abortController) {
          controller.current = null;
          setProgress(null);
        }
      });
    return () => abortController.abort();
  }, [
    filterKey,
    listComplete,
    paused,
    remoteAllowed,
    mobileWarning,
    mobileAccepted,
  ]);
  return { progress, cancel };
}
