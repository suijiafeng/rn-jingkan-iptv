import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Network from "expo-network";
import type { Channel } from "../../domain/types";
import { isOffline, mightUseMobileData } from "../player/playbackController";
import {
  checkAvailability,
  type CheckStore,
} from "../source/availabilityCoordinator";

/** At most this many channels are checked per category switch. */
export const AUTO_CHECK_MAX = 200;

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
  repo: CheckStore | null;
  /** Called once after a finished (not cancelled) sweep, to re-sort. */
  onFinished: () => void;
  onError: (message: string) => void;
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
  const lastFilter = useRef<string | null>(null);
  const completedFilter = useRef<string | null>(null);
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
    repo,
  } = options;
  useEffect(() => {
    if (lastFilter.current !== filterKey) {
      lastFilter.current = filterKey;
      completedFilter.current = null;
    }
    if (
      filterKey === null ||
      !listComplete ||
      paused ||
      !remoteAllowed ||
      !repo ||
      completedFilter.current === filterKey
    )
      return;
    const targets = latest.current.channels.filter((channel) => channel.active);
    if (!targets.length) return;
    const abortController = new AbortController();
    controller.current?.abort();
    controller.current = abortController;
    const app = AppState.addEventListener("change", (state) => {
      if (state !== "active") abortController.abort();
    });
    const run = async () => {
      const { refreshed, skipped } = await checkAvailability(repo, targets, {
        signal: abortController.signal,
        maxRequests: AUTO_CHECK_MAX,
        beforeRequests: async () => {
          const net = await Network.getNetworkStateAsync();
          return (
            !abortController.signal.aborted &&
            !isOffline(net) &&
            !(mobileWarning && !mobileAccepted && mightUseMobileData(net))
          );
        },
        isPermitted: () =>
          !abortController.signal.aborted &&
          latest.current.remoteAllowed &&
          AppState.currentState === "active",
        onProgress: (done, total) => {
          if (!abortController.signal.aborted) setProgress({ done, total });
        },
      });
      // Re-sort once at the end, not under the user's finger mid-check.
      if (!abortController.signal.aborted && !skipped) {
        completedFilter.current = filterKey;
        if (refreshed) latest.current.onFinished();
      }
    };
    run()
      .catch(() => {
        if (!abortController.signal.aborted)
          latest.current.onError("连通测试未完成，可在来源管理中重试");
      })
      .finally(() => {
        if (controller.current === abortController) {
          controller.current = null;
          setProgress(null);
        }
      });
    return () => {
      app.remove();
      abortController.abort();
    };
  }, [
    filterKey,
    listComplete,
    paused,
    remoteAllowed,
    mobileWarning,
    mobileAccepted,
    repo,
  ]);
  return { progress, cancel };
}
