import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AccessibilityInfo,
  Alert,
  AppState,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Network from "expo-network";
import { colors } from "../../theme";
import type { Channel } from "../../domain/types";
import { qualityName } from "../../domain/channelSources";
import { channelTitle } from "../../domain/channelLabels";
import { MediaHandle } from "./mediaHandle";
import {
  PauseIcon,
  PictureInPictureIcon,
  PlayIcon,
  RefreshIcon,
  HeadphonesIcon,
  ScreenIcon,
  VolumeIcon,
} from "./playerIcons";
import { OverlayButton, SourceChip } from "./overlayWidgets";
import { sourcePosition } from "./sourceFailover";
import {
  CenterChip,
  LoadingDots,
  MobileDataPrompt,
  playerNotice,
  usePlayerNotices,
  useSlowStart,
} from "./playerStatus";
import {
  adjacentPlayableIndex,
  PlaybackController,
} from "./playbackController";
import {
  CONTROLS_FIRST_HIDE_MS,
  CONTROLS_HIDE_MS,
  descriptions,
  OSD_MS,
  sameChannel,
} from "./playerShared";
import type { SessionProps } from "./ChannelSession";

/**
 * Everything a channel session computes before rendering: the playback
 * controller and its snapshot, the media handle, overlay visibility, the
 * primary (play/pause/cancel/retry) action, zapping and the shared buttons.
 */
export function useChannelSession(props: SessionProps) {
  const insets = useSafeAreaInsets();
  const { sourcesOpen, onSourcesOpenChange: setSourcesOpen } = props;
  const [controller] = useState(
    () =>
      new PlaybackController({
        remoteAllowed: props.remoteAllowed,
        backgroundAllowed: props.backgroundAllowed,
        mobileWarning: props.mobileWarning,
        checkNetwork: Network.getNetworkStateAsync,
        isAppActive: () => AppState.currentState === "active",
        onStarted: () => props.onStarted(props.channel),
        onAvailability: (ok) => props.onAvailability?.(props.channel, ok),
      }),
  );
  const { onStarted, onAvailability, channel } = props;
  useEffect(() => {
    controller.setOnAvailability((ok) => onAvailability?.(channel, ok));
  }, [controller, onAvailability, channel]);
  useEffect(() => {
    controller.setOnStarted(() => onStarted(channel));
  }, [controller, onStarted, channel]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  // One handle per channel session; each attempt's native player attaches to it.
  const [media] = useState(() => new MediaHandle());
  const mediaInfo = useSyncExternalStore(
    media.subscribeInfo,
    media.getInfo,
    media.getInfo,
  );
  const [scrubbing, setScrubbing] = useState(false);
  // The mobile-data prompt's "不再提醒" box, applied when the user continues.
  const [stopReminding, setStopReminding] = useState(false);
  useEffect(() => {
    const network = Network.addNetworkStateListener((next) =>
      controller.networkChanged(next),
    );
    const app = AppState.addEventListener("change", (next) =>
      controller.appStateChanged(next),
    );
    controller.activate();
    void controller.requestPlay();
    return () => {
      network.remove();
      app.remove();
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    controller.setPolicy(props.remoteAllowed, props.mobileWarning);
  }, [controller, props.remoteAllowed, props.mobileWarning]);
  useEffect(() => {
    controller.setBackgroundAllowed(!!props.backgroundAllowed);
  }, [controller, props.backgroundAllowed]);
  // A finished attempt without a picture is reported once; the failover
  // decides whether another address of this channel is worth a try.
  const { onFailure, onUserPlay } = props.failover;
  useEffect(() => {
    if (state.phase === "timeout") onFailure("timeout");
    else if (state.phase === "error") onFailure(state.failure ?? "unknown");
  }, [state.phase, state.failure, onFailure]);

  // Overlay controls (both modes): tap the picture to toggle; they auto-hide
  // only while actually playing, and never for screen-reader users.
  const { controlsShown, onControlsShownChange: setControlsShown } = props;
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((enabled) => {
        if (live) setScreenReader(enabled);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setScreenReader,
    );
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  const autoHide =
    !props.audioOnly &&
    controlsShown &&
    !props.sheetOpen &&
    !sourcesOpen &&
    !scrubbing &&
    !screenReader &&
    state.phase === "playing";
  // The first show of a new stream stays longer; once hidden (by the timer
  // or a tap), later shows use the short delay.
  const firstShow = useRef(true);
  useEffect(() => {
    firstShow.current = true;
  }, [state.attemptId]);
  useEffect(() => {
    if (!controlsShown) firstShow.current = false;
  }, [controlsShown]);
  useEffect(() => {
    if (!autoHide) return;
    const timer = setTimeout(
      () => setControlsShown(false),
      firstShow.current ? CONTROLS_FIRST_HIDE_MS : CONTROLS_HIDE_MS,
    );
    return () => clearTimeout(timer);
  }, [autoHide, setControlsShown]);
  // Loading keeps the picture clear for zapping; states that need a decision
  // (error, timeout, paused, cellular...) always bring the controls back.
  const loading = ["checking", "connecting", "buffering"].includes(state.phase);
  // The system's small window has its own controls; ours would cover it.
  const controlsVisible =
    !mediaInfo.pictureInPicture &&
    (props.audioOnly ||
      controlsShown ||
      props.sheetOpen ||
      screenReader ||
      (state.phase !== "playing" && !loading));

  const busy = ["checking", "connecting", "playing", "buffering"].includes(
    state.phase,
  );
  const waiting = ["checking", "connecting", "buffering"].includes(state.phase);
  const starting = ["checking", "connecting"].includes(state.phase);
  const canRetry = ["offline", "timeout", "error", "ended"].includes(
    state.phase,
  );
  // Paused in place: the attempt (and its native player) is still alive.
  const retained = state.phase === "paused" && state.attemptId !== null;
  const pausedAt = useRef<number | null>(null);
  useEffect(() => {
    pausedAt.current = retained ? Date.now() : null;
  }, [retained, state.attemptId]);
  const primaryLabel =
    state.phase === "cellular"
      ? "用流量播放"
      : starting
        ? "取消"
        : busy
          ? "暂停"
          : canRetry
            ? "重试"
            : "播放";
  const primaryAction = () => {
    // On a possibly metered network ▶ is the explicit "continue" answer.
    if (state.phase === "cellular") {
      if (stopReminding) props.onStopMobileReminders?.();
      props.onMobileAccepted?.();
      onUserPlay();
      void controller.requestPlay(true);
      return;
    }
    const id = state.attemptId;
    // Pause in place so the last frame stays on screen; catch-up streams also
    // keep their position. Live resumes on the same player, or reconnects at
    // the live edge once the pause has gone stale (see below).
    if (
      id !== null &&
      (state.phase === "playing" || state.phase === "buffering") &&
      media.pause()
    ) {
      if (!controller.userPaused(id)) controller.pause();
      return;
    }
    if (retained) {
      const expiredLive =
        mediaInfo.isLive &&
        pausedAt.current !== null &&
        Date.now() - pausedAt.current >= 60_000;
      if (!expiredLive && media.play()) return;
      onUserPlay();
      void controller.requestPlay();
      return;
    }
    if (busy) controller.pause();
    else {
      onUserPlay();
      void controller.requestPlay();
    }
  };
  const index = props.channels.findIndex((channel) =>
    sameChannel(channel, props.channel),
  );
  const skip = (channel: Channel) =>
    !!props.skipUnreachable && channel.checkStatus === "unreachable";
  const previous = adjacentPlayableIndex(props.channels, index, -1, skip);
  const next = adjacentPlayableIndex(props.channels, index, 1, skip);
  const selectNext = () => {
    if (next !== null) props.onSelect(props.channels[next]);
  };
  const title = channelTitle(props.channel.name).title;

  // Short name/position overlay, shown on arrival in fullscreen and at edges.
  const [osd, setOsd] = useState<string | null>(null);
  const osdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showOsd = useCallback((text: string) => {
    if (osdTimer.current !== null) clearTimeout(osdTimer.current);
    setOsd(text);
    osdTimer.current = setTimeout(() => {
      osdTimer.current = null;
      setOsd(null);
    }, OSD_MS);
  }, []);
  const position =
    index >= 0 ? `${index + 1}/${props.channels.length} · ${title}` : title;
  const arrivedFullscreen = useRef(props.fullscreen);
  useEffect(() => {
    if (arrivedFullscreen.current) showOsd(position);
    return () => {
      if (osdTimer.current !== null) clearTimeout(osdTimer.current);
    };
    // Only on arrival of this channel session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const zap = (direction: -1 | 1) => {
    const step = props.swipeReverse ? (-direction as -1 | 1) : direction;
    const target = step === 1 ? next : previous;
    if (target !== null) props.onSelect(props.channels[target]);
    else showOsd(step === 1 ? "已经是最后一个频道" : "已经是第一个频道");
  };

  const description =
    starting && props.failover.connectingTitle
      ? { ...descriptions[state.phase], title: props.failover.connectingTitle }
      : descriptions[state.phase];
  const pausedBody =
    state.pauseReason === "background"
      ? "切到后台时暂停"
      : state.pauseReason === "interrupted"
        ? "音频被其他应用占用，已暂停"
        : "";
  // Glyph of the primary key: ▶ when paused or stopped, ❚❚ while playing.
  // It sits in the middle of the picture; loading shows the dots there, and
  // failures and the mobile-data question put their one action there.
  const showsPlay = retained || !busy;
  const primaryIcon = starting ? "■" : canRetry ? "↻" : showsPlay ? "▶" : "❚❚";
  const primaryDisabled = !props.remoteAllowed;
  const playPauseButton = (
    <Pressable
      testID="primary-play-pause"
      accessibilityRole="button"
      accessibilityLabel={primaryLabel}
      accessibilityState={{ disabled: primaryDisabled }}
      disabled={primaryDisabled}
      hitSlop={4}
      onPress={primaryAction}
      style={({ pressed }) => [
        styles.centerButton,
        !props.fullscreen && styles.centerButtonCompact,
        pressed && styles.pressed,
        primaryDisabled && styles.disabled,
      ]}
    >
      {showsPlay ? (
        <PlayIcon size={props.fullscreen ? 28 : 24} />
      ) : (
        <PauseIcon size={props.fullscreen ? 28 : 24} />
      )}
    </Pressable>
  );
  // Notices (failures, slow start, mobile data...) go to the global toast;
  // the picture itself only shows the dots or the one action.
  const slow = useSlowStart(waiting, state.attemptId);
  usePlayerNotices(
    playerNotice({
      phase: state.phase,
      connectingTitle: props.failover.connectingTitle,
      pausedBody,
      slow,
    }),
    state.attemptId,
  );
  const centerStatus = waiting ? (
    <LoadingDots slow={slow} />
  ) : canRetry ? (
    <CenterChip
      label="重试"
      icon={<RefreshIcon size={15} />}
      disabled={primaryDisabled}
      onPress={primaryAction}
    />
  ) : state.phase === "cellular" ? (
    // A question that waits for an answer stays on the picture, not a toast.
    <MobileDataPrompt
      stopReminding={stopReminding}
      onStopRemindingChange={setStopReminding}
      disabled={primaryDisabled}
      onContinue={primaryAction}
    />
  ) : state.phase === "blocked" ? null : (
    playPauseButton
  );
  // Which of the channel's addresses is playing (2/3); the chip opens the
  // list with each address (a popover in fullscreen, a sheet in portrait),
  // so even a single source opens it. TalkBack also hears quality and name.
  const sourceButton = (
    <SourceChip
      position={sourcePosition(props.sources, props.channel)?.index ?? 1}
      count={props.sources.length}
      accessibilityLabel={
        props.sources.length > 1
          ? `视频来源：${qualityName(props.channel)} · ${props.channel.sourceName}，共 ${props.sources.length} 个，点击切换`
          : `视频来源：${qualityName(props.channel)} · ${props.channel.sourceName}，点击查看地址`
      }
      solid={!props.fullscreen}
      onPress={() => setSourcesOpen(!sourcesOpen)}
    />
  );

  const favoriteButton = (
    <Pressable
      style={[styles.favoriteHit, !props.fullscreen && styles.favoriteSolid]}
      accessibilityRole="button"
      accessibilityLabel={
        props.channel.favorite ? "取消收藏当前频道" : "收藏当前频道"
      }
      accessibilityState={{ selected: props.channel.favorite }}
      onPress={() => props.onFavorite(props.channel)}
    >
      <Text style={[styles.star, props.channel.favorite && styles.starOn]}>
        {props.channel.favorite ? "★" : "☆"}
      </Text>
    </Pressable>
  );

  const pictureInPictureButton = state.attemptId !== null && (
    <OverlayButton
      label="画中画"
      icon={<PictureInPictureIcon />}
      accessibilityLabel="进入画中画"
      variant="quiet"
      onPress={() => {
        void media.startPictureInPicture().then((success) => {
          if (!success)
            Alert.alert(
              "未能进入画中画",
              "请确认系统允许静看使用画中画，并在视频开始播放后重试。若是用返回键退出后重新打开的，请先从最近任务中彻底关闭应用再试。",
            );
        });
      }}
    />
  );

  const muteButton = (
    <OverlayButton
      label={props.muted ? "取消静音" : "静音"}
      icon={<VolumeIcon muted={props.muted} />}
      variant="quiet"
      selected={props.muted}
      onPress={() => props.onMutedChange(!props.muted)}
    />
  );
  // The glyph names what a tap switches to: headphones while watching, a
  // screen while listening (the picture itself says it is listening).
  const audioButton = (
    <OverlayButton
      label={props.audioOnly ? "看视频" : "听音频"}
      icon={props.audioOnly ? <ScreenIcon /> : <HeadphonesIcon />}
      variant="quiet"
      onPress={props.onToggleAudioOnly}
    />
  );

  return {
    insets,
    sourcesOpen,
    setSourcesOpen,
    controller,
    state,
    media,
    mediaInfo,
    setScrubbing,
    setControlsShown,
    controlsVisible,
    busy,
    waiting,
    starting,
    canRetry,
    retained,
    primaryLabel,
    primaryAction,
    index,
    previous,
    next,
    selectNext,
    title,
    osd,
    zap,
    description,
    pausedBody,
    showsPlay,
    primaryIcon,
    primaryDisabled,
    centerStatus,
    sourceButton,
    favoriteButton,
    pictureInPictureButton,
    muteButton,
    audioButton,
  };
}

export type SessionView = ReturnType<typeof useChannelSession>;

const styles = StyleSheet.create({
  centerButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#04080A73",
    borderWidth: 1,
    borderColor: "#FFFFFF33",
  },
  centerButtonCompact: { width: 56, height: 56, borderRadius: 28 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  favoriteHit: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  favoriteSolid: { borderRadius: 12, backgroundColor: colors.raised },
  star: { color: colors.muted, fontSize: 20, lineHeight: 24 },
  starOn: { color: colors.warn },
});
