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
import { isIptvOrgId } from "../../domain/channelFacets";
import { checkChannels } from "../source/availability";
import { lookupIptvOrgLanguages } from "../source/iptvOrgLanguages";
import type { CheckProgress, CheckSummary } from "../source/SourceManagerModal";

/**
 * User-started work on one source from source management: the availability
 * sweep and the iptv-org language lookup. Both pass the same network gates
 * as an import and stop when permission is withdrawn.
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
    // iptv-org language lookup (user-triggered, one download).
    [languageLookup, setLanguageLookup] = useState<string | null>(null),
    [languageMessages, setLanguageMessages] = useState<Record<string, string>>(
      {},
    );
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
   * from the iptv-org database. Same gates as any other remote request.
   */
  const runLanguageLookup = async (source: Source) => {
    if (!repo || languageController.current) return;
    const abort = new AbortController();
    languageController.current = abort;
    const epoch = permissionEpoch.current;
    const current = () =>
      mounted.current &&
      languageController.current === abort &&
      !abort.signal.aborted &&
      epoch === permissionEpoch.current;
    const say = (message: string) =>
      setLanguageMessages((all) => ({ ...all, [source.id]: message }));
    setLanguageLookup(source.id);
    try {
      if (!(await guardRemote(abort.signal)) || !current()) return;
      if (!(await checkNetwork(abort.signal)) || !current()) return;
      const targets = (
        await repo.listChannels({ sourceId: source.id, includeVariants: true })
      ).filter(
        (channel) => isIptvOrgId(channel.tvgId) && !channel.languages?.length,
      );
      if (!current()) return;
      if (!targets.length) {
        say("没有需要补全的频道");
        return;
      }
      const found = await lookupIptvOrgLanguages(
        new Set(targets.map((channel) => channel.tvgId!)),
        abort.signal,
      );
      if (!current()) return;
      const changedCount = await repo.saveLookedUpLanguages(
        targets.flatMap((channel) => {
          const languages = found.get(channel.tvgId!);
          return languages
            ? [{ channelId: channel.id, tvgId: channel.tvgId!, languages }]
            : [];
        }),
      );
      say(`已补全 ${changedCount} 个频道的语言`);
      changed();
    } catch (failure) {
      if (mounted.current && epoch === permissionEpoch.current)
        say(
          failure instanceof Error && failure.message
            ? failure.message
            : "补全语言失败，请稍后重试",
        );
    } finally {
      if (languageController.current === abort) {
        languageController.current = null;
        setLanguageLookup(null);
      }
    }
  };

  /** Manual, user-started availability sweep of one source's channels. */
  const runCheck = async (source: Source) => {
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
    let started = false;
    let savingResults = false;
    setError("");
    setCheck({ sourceId: source.id, done: 0, total: null });
    try {
      if (!(await guardRemote(abort.signal)) || !allowed()) return;
      if (!(await checkNetwork(abort.signal)) || !allowed()) return;
      const targets = await repo.listChannels({
        sourceId: source.id,
        includeVariants: true,
      });
      if (!allowed()) return;
      setCheck({ sourceId: source.id, done: 0, total: targets.length });
      started = true;
      const results = await checkChannels(targets, {
        signal: abort.signal,
        onProgress: (done, total) => {
          if (allowed()) setCheck({ sourceId: source.id, done, total });
        },
      });
      // Manual stop may save finished results, but a newer sweep or revocation
      // makes this task obsolete and must not publish its results.
      if (!stillPermitted()) return;
      savingResults = true;
      await repo.saveCheckResults(results);
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
        (savingResults || !abort.signal.aborted) &&
        epoch === permissionEpoch.current
      )
        setError(
          started
            ? "检测结果未能保存，请重试"
            : failure instanceof ImportIOError
              ? failure.message
              : "无法开始检测，请检查网络后重试",
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
    languageMessages,
    runCheck,
    runLanguageLookup,
    stopCheck,
    stopLanguageLookup,
    stopForSource,
  };
}
