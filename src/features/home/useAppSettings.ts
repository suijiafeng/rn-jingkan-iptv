import { useEffect, useRef, useState } from "react";
import * as Network from "expo-network";
import { openRepository, Repository } from "../../data/repository";
import { ImportIOError } from "../../data/importIO";
import { confirm } from "../common/confirm";
import { askConsent } from "../common/ConsentDialog";
import { ARTWORK_CONSENT, BACKGROUND_CONSENT } from "../common/consents";
import { isOffline, mightUseMobileData } from "../player/playbackController";
import type { Tab } from "../channel/ChannelListParts";

/** A boolean setting that is shown at once and rolled back if saving fails. */
export type SavedToggleKey =
  "mobileWarning" | "swipeReverse" | "miniPlayer" | "backgroundPlayback";

/**
 * Opens the local database and owns the settings and network permissions
 * every other part of the home screen checks before going online.
 */
export function useAppSettings({
  setError,
  setTab,
}: {
  setError: (message: string) => void;
  setTab: (tab: Tab) => void;
}) {
  const [repo, setRepo] = useState<Repository | null>(null),
    [startupAttempt, setStartupAttempt] = useState(0),
    [remoteAllowed, setRemoteAllowed] = useState(false),
    [revokePending, setRevokePending] = useState(false),
    [mobileWarning, setMobileWarning] = useState(true),
    // On by default; switching it back on after turning it off asks again.
    [backgroundPlayback, setBackgroundPlayback] = useState(true),
    [backgroundSaving, setBackgroundSaving] = useState(false),
    [swipeReverse, setSwipeReverse] = useState(false),
    // Leaving the player docks it in a small floating window.
    [miniPlayer, setMiniPlayer] = useState(true),
    [artworkAllowed, setArtworkAllowed] = useState(false),
    [artworkSaving, setArtworkSaving] = useState(false),
    [artworkRevokePending, setArtworkRevokePending] = useState(false),
    [guideOrigin, setGuideOrigin] = useState<"firstRun" | "settings" | null>(
      null,
    ),
    // One confirmation covers this metered connection until Wi-Fi returns.
    [mobileAccepted, setMobileAcceptedState] = useState(false),
    // The network consent dialog: null while hidden, else whether it also
    // stands in for the mobile-data confirmation.
    [consentCellular, setConsentCellular] = useState<boolean | null>(null);
  const mounted = useRef(true),
    consentAnswer = useRef<((allowed: boolean) => void) | null>(null),
    // Read by checks that run right after consent in the same task, before
    // a re-render could hand them the new state.
    mobileAcceptedRef = useRef(false),
    preserveTabOnReload = useRef(false),
    remoteRef = useRef(false),
    // Bumped on revocation; async work started under an older epoch stops.
    permissionEpoch = useRef(0),
    artworkMutation = useRef(false);

  const setMobileAccepted = (accepted: boolean) => {
    mobileAcceptedRef.current = accepted;
    setMobileAcceptedState(accepted);
  };

  useEffect(() => {
    mounted.current = true;
    let active = true;
    openRepository()
      .then(async (opened) => {
        const allowed = await opened.getSetting("remoteAllowed", false);
        const warning = await opened.getSetting("mobileWarning", true);
        const background = await opened.getSetting("backgroundPlayback", true);
        const reverse = await opened.getSetting("swipeReverse", false);
        const docking = await opened.getSetting("miniPlayer", true);
        const artwork = await opened.getSetting("artworkAllowed", false);
        const favorites = await opened.listChannels({ mode: "favorites" });
        const guideSeen = await opened.getSetting("guideSeen", false);
        if (active) {
          remoteRef.current = allowed;
          setRemoteAllowed(allowed);
          setMobileWarning(warning);
          setBackgroundPlayback(background);
          setSwipeReverse(reverse);
          setMiniPlayer(docking);
          setArtworkAllowed(artwork);
          // Only a true first run: people who already added sources skip
          // it. The check does not hold up opening the home screen.
          if (!guideSeen)
            void opened
              .listSources()
              .then((saved) => {
                if (active && !saved.length) setGuideOrigin("firstRun");
              })
              .catch(() => undefined);
          if (!preserveTabOnReload.current)
            setTab(favorites.length ? "favorites" : "all");
          preserveTabOnReload.current = false;
          setRepo(opened);
        }
      })
      .catch(() => {
        if (active) setError("本地资料未能打开，数据未清空");
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [startupAttempt, setError, setTab]);

  useEffect(() => {
    const subscription = Network.addNetworkStateListener((network) => {
      if (!isOffline(network) && !mightUseMobileData(network))
        setMobileAccepted(false);
    });
    return () => subscription.remove();
  }, []);

  const guardRemote = async (signal?: AbortSignal) => {
    if (signal?.aborted) return false;
    if (remoteRef.current) return true;
    if (revokePending) {
      setError("请先在设置中完成撤销联网许可");
      return false;
    }
    const epoch = permissionEpoch.current;
    // On mobile data the consent also covers the data warning: one question
    // for a first play instead of two.
    const network = await Network.getNetworkStateAsync().catch(() => null);
    const cellular =
      mobileWarning &&
      !mobileAcceptedRef.current &&
      !!network &&
      !isOffline(network) &&
      mightUseMobileData(network);
    const accepted = await new Promise<boolean>((resolve) => {
      consentAnswer.current?.(false);
      consentAnswer.current = resolve;
      setConsentCellular(cellular);
    });
    if (
      !accepted ||
      !repo ||
      signal?.aborted ||
      epoch !== permissionEpoch.current ||
      !mounted.current
    )
      return false;
    try {
      await repo.setSetting("remoteAllowed", true);
    } catch {
      setError("联网许可未保存，请重试");
      return false;
    }
    if (epoch !== permissionEpoch.current || !mounted.current) return false;
    remoteRef.current = true;
    setRemoteAllowed(true);
    if (cellular) setMobileAccepted(true);
    return true;
  };

  const checkNetwork = async (signal?: AbortSignal) => {
    const network = await Network.getNetworkStateAsync();
    if (signal?.aborted) return false;
    if (isOffline(network))
      throw new ImportIOError("当前没有可用网络，请连接后重试");
    // Same rule as playback: VPN/unknown transports may be metered.
    if (
      mobileWarning &&
      !mobileAcceptedRef.current &&
      mightUseMobileData(network)
    ) {
      const accepted = await confirm(
        "可能使用移动数据？",
        "下载节目单或播放直播会消耗流量。确认后，在连回 Wi-Fi 之前不再询问。",
        "继续",
      );
      if (signal?.aborted) return false;
      if (accepted) setMobileAccepted(true);
      return accepted;
    }
    return true;
  };

  const changeArtwork = async (enabled: boolean) => {
    if (!repo || artworkMutation.current) return;
    artworkMutation.current = true;
    setArtworkSaving(true);
    const epoch = permissionEpoch.current;
    try {
      if (enabled) {
        if (!remoteRef.current || revokePending || artworkRevokePending) return;
        const accepted = (await askConsent(ARTWORK_CONSENT)) === "allow";
        if (
          !accepted ||
          epoch !== permissionEpoch.current ||
          !remoteRef.current ||
          !mounted.current
        )
          return;
      } else {
        // Stop visible requests immediately, even if persisting revocation fails.
        setArtworkAllowed(false);
        setArtworkRevokePending(true);
      }
      await repo.setSetting("artworkAllowed", enabled);
      if (mounted.current && epoch === permissionEpoch.current) {
        setArtworkAllowed(enabled);
        setArtworkRevokePending(false);
      }
    } catch {
      if (mounted.current)
        setError(enabled ? "台标开启未保存，请重试" : "台标关闭未保存，请重试");
    } finally {
      artworkMutation.current = false;
      if (mounted.current) setArtworkSaving(false);
    }
  };

  const toggleSetters: Record<SavedToggleKey, (value: boolean) => void> = {
    mobileWarning: setMobileWarning,
    backgroundPlayback: setBackgroundPlayback,
    swipeReverse: setSwipeReverse,
    miniPlayer: setMiniPlayer,
  };
  const saveToggle = (key: SavedToggleKey, value: boolean) => {
    const setValue = toggleSetters[key];
    setValue(value);
    void repo?.setSetting(key, value).catch(() => {
      setValue(!value);
      setError("设置未保存，请重试");
    });
  };

  const changeBackgroundPlayback = async (enabled: boolean) => {
    if (!repo || backgroundSaving || enabled === backgroundPlayback) return;
    if (enabled) {
      const accepted = (await askConsent(BACKGROUND_CONSENT)) === "allow";
      if (!accepted || !mounted.current) return;
    }
    setBackgroundSaving(true);
    setBackgroundPlayback(enabled);
    try {
      await repo.setSetting("backgroundPlayback", enabled);
    } catch {
      if (mounted.current) {
        setBackgroundPlayback(!enabled);
        setError("后台播放设置未保存，请重试");
      }
    } finally {
      if (mounted.current) setBackgroundSaving(false);
    }
  };

  /** Drops network permission in memory first, so nothing new goes online. */
  const withdrawRemote = () => {
    permissionEpoch.current++;
    remoteRef.current = false;
    setRemoteAllowed(false);
    setRevokePending(true);
  };

  /**
   * Closes the guide for good. A failed save only shows it again on the
   * next launch, so it is not reported.
   */
  const finishGuide = () => {
    setGuideOrigin(null);
    void repo?.setSetting("guideSeen", true).catch(() => undefined);
  };

  /** After "清空全部": every setting is back to its first-run value. */
  const resetToDefaults = () => {
    setRevokePending(false);
    setMobileWarning(true);
    setBackgroundPlayback(true);
    setMobileAccepted(false);
    setSwipeReverse(false);
    setMiniPlayer(true);
    setArtworkAllowed(false);
    setArtworkRevokePending(false);
  };

  return {
    repo,
    retryStartup: () => setStartupAttempt((attempt) => attempt + 1),
    reloadSettings: () => {
      preserveTabOnReload.current = true;
      setStartupAttempt((attempt) => attempt + 1);
    },
    mounted,
    remoteRef,
    permissionEpoch,
    remoteAllowed,
    revokePending,
    setRevokePending,
    mobileWarning,
    backgroundPlayback,
    backgroundSaving,
    mobileAccepted,
    setMobileAccepted,
    swipeReverse,
    miniPlayer,
    artworkAllowed,
    artworkSaving,
    artworkRevokePending,
    /** Logos load only with their own consent and live network permission. */
    artworkEnabled: artworkAllowed && remoteAllowed && !revokePending,
    guardRemote,
    /** Whether the consent dialog shows, and with the mobile-data line. */
    consentCellular,
    answerConsent: (allowed: boolean) => {
      const answer = consentAnswer.current;
      consentAnswer.current = null;
      setConsentCellular(null);
      answer?.(allowed);
    },
    checkNetwork,
    changeArtwork,
    saveToggle,
    changeBackgroundPlayback,
    withdrawRemote,
    resetToDefaults,
    guideVisible: guideOrigin !== null,
    /** Opened from 设置 › 使用指引: the guide gets a top-left back. */
    guideFromSettings: guideOrigin === "settings",
    showGuide: () => setGuideOrigin("settings"),
    finishGuide,
  };
}

export type AppSettings = ReturnType<typeof useAppSettings>;
