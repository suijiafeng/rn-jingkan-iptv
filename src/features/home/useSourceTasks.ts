import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { AppState } from "react-native";
import type { Repository } from "../../data/repository";
import type { Source } from "../../domain/types";
import { ImportIOError } from "../../data/importIO";
import {
  AvailabilitySaveError,
  checkAvailability,
} from "../source/availabilityCoordinator";
import {
  lookupIptvOrgLanguages,
  needsLanguageLookup,
} from "../source/iptvOrgLanguages";
import type { CheckProgress, CheckSummary } from "../source/availability";

/**
 * Network work on one source: the availability sweep started from source
 * management, and the iptv-org language lookup that follows an import whose
 * preview asked for it. Both pass the same network gates as an import and
 * stop when permission is withdrawn.
 */
export function useSourceTasks({
  repo,
  setError,
  mounted,
  remoteRef,
  permissionEpoch,
  guardRemote,
  checkNetwork,
  changed,
}: {
  repo: Repository | null;
  setError: (message: string) => void;
  mounted: MutableRefObject<boolean>;
  remoteRef: MutableRefObject<boolean>;
  permissionEpoch: MutableRefObject<number>;
  guardRemote: (signal?: AbortSignal) => Promise<boolean>;
  checkNetwork: (signal?: AbortSignal) => Promise<boolean>;
  changed: () => void;
}) {
  const [check, setCheck] = useState<CheckProgress | null>(null),
    [checkSummaries, setCheckSummaries] = useState<
      Record<string, CheckSummary>
    >({}),
    // iptv-org language lookup after an import (one download).
    [languageLookup, setLanguageLookup] = useState<string | null>(null);
  const checkController = useRef<AbortController | null>(null),
    languageController = useRef<AbortController | null>(null),
    checkGeneration = useRef(0);

  useEffect(
    () => () => {
      checkController.current?.abort();
      languageController.current?.abort();
    },
    [],
  );

  const stopCheck = useCallback(() => {
    checkController.current?.abort();
    checkController.current = null;
    setCheck(null);
  }, []);
  const stopLanguageLookup = useCallback(() => {
    languageController.current?.abort();
    languageController.current = null;
    setLanguageLookup(null);
  }, []);

  /**
   * Fills missing languages for this source's iptv-org formatted channels
   * from the iptv-org database. Same gates as any other remote request;
   * success shows in the language filter, only a failure is reported.
   */
  const runLanguageLookup = async (sourceId: string) => {
    if (!repo || languageController.current) return;
    const abort = new AbortController();
    languageController.current = abort;
    const epoch = permissionEpoch.current;
    const current = () =>
      mounted.current &&
      languageController.current === abort &&
      !abort.signal.aborted &&
      epoch === permissionEpoch.current;
    setLanguageLookup(sourceId);
    try {
      if (!(await guardRemote(abort.signal)) || !current()) return;
      if (!(await checkNetwork(abort.signal)) || !current()) return;
      const targets = (
        await repo.listChannels({ sourceId, includeVariants: true })
      ).filter(needsLanguageLookup);
      if (!current() || !targets.length) return;
      const found = await lookupIptvOrgLanguages(
        new Set(targets.map((channel) => channel.tvgId!)),
        abort.signal,
      );
      if (!current()) return;
      await repo.saveLookedUpLanguages(
        targets.flatMap((channel) => {
          const languages = found.get(channel.tvgId!);
          return languages
            ? [{ channelId: channel.id, tvgId: channel.tvgId!, languages }]
            : [];
        }),
      );
      changed();
    } catch (failure) {
      if (current())
        setError(
          failure instanceof Error && failure.message
            ? `频道已导入，语言未补全：${failure.message}`
            : "频道已导入，语言暂未补全",
        );
    } finally {
      if (languageController.current === abort) {
        languageController.current = null;
        setLanguageLookup(null);
      }
    }
  };

  /** Manual, user-started availability sweep of one source's channels. */
  const runCheck = async (source: Source, force = false) => {
    if (!repo || checkController.current || AppState.currentState !== "active")
      return;
    const abort = new AbortController();
    checkController.current = abort;
    const task = ++checkGeneration.current;
    const epoch = permissionEpoch.current;
    const current = () => mounted.current && task === checkGeneration.current;
    const allowed = () =>
      current() &&
      checkController.current === abort &&
      !abort.signal.aborted &&
      remoteRef.current &&
      epoch === permissionEpoch.current &&
      AppState.currentState === "active";
    const stillPermitted = () =>
      current() && epoch === permissionEpoch.current && remoteRef.current;
    setError("");
    setCheck({ sourceId: source.id, done: 0, total: null });
    try {
      if (!(await guardRemote(abort.signal)) || !allowed()) return;
      const targets = await repo.listChannels({
        sourceId: source.id,
        includeVariants: true,
      });
      if (!allowed()) return;
      const { results, skipped } = await checkAvailability(repo, targets, {
        signal: abort.signal,
        force,
        isPermitted: stillPermitted,
        beforeRequests: async () =>
          (await checkNetwork(abort.signal)) && allowed(),
        onProgress: (done, total) => {
          if (allowed()) setCheck({ sourceId: source.id, done, total });
        },
      });
      // Manual stop may save finished results, but a newer sweep or revocation
      // makes this task obsolete and must not publish its results.
      if (skipped || !stillPermitted()) return;
      if (!stillPermitted()) return;
      const reachable = results.filter((result) => result.ok).length;
      setCheckSummaries((all) => ({
        ...all,
        [source.id]: {
          ok: reachable,
          unreachable: results.length - reachable,
          stopped: abort.signal.aborted,
        },
      }));
      changed();
    } catch (failure) {
      if (
        current() &&
        (failure instanceof AvailabilitySaveError || !abort.signal.aborted) &&
        epoch === permissionEpoch.current
      )
        setError(
          failure instanceof AvailabilitySaveError
            ? failure.message
            : failure instanceof ImportIOError
              ? failure.message
              : "测试未完成，可重新测试",
        );
    } finally {
      if (checkController.current === abort) {
        checkController.current = null;
        setCheck(null);
      }
    }
  };

  /** Stops whatever runs for a source that is about to be deleted. */
  const stopForSource = (sourceId: string) => {
    if (check?.sourceId === sourceId) stopCheck();
    if (languageLookup === sourceId) stopLanguageLookup();
  };

  return {
    check,
    checkSummaries,
    clearCheckSummaries: () => setCheckSummaries({}),
    languageLookup,
    runCheck,
    runLanguageLookup,
    stopCheck,
    stopLanguageLookup,
    stopForSource,
  };
}
