import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AccessibilityInfo,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Network from "expo-network";
import { colors } from "../../theme";
import type { Channel } from "../../domain/types";
import { qualityName } from "../../domain/channelSources";
import { channelTitle } from "../../domain/channelLabels";
import { MediaHandle } from "./mediaHandle";
import { OverlayButton, SourceChip } from "./overlayWidgets";
import {
  adjacentPlayableIndex,
  PlaybackController,
} from "./playbackController";
import {
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
        mobileWarning: props.mobileWarning,
        checkNetwork: Network.getNetworkStateAsync,
        isAppActive: () => AppState.currentState === "active",
        onStarted: () => props.onStarted(props.channel),
      }),
  );
  const { onStarted, channel } = props;
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
    controlsShown &&
    !props.sheetOpen &&
    !sourcesOpen &&
    !scrubbing &&
    !screenReader &&
    state.phase === "playing";
  useEffect(() => {
    if (!autoHide) return;
    const timer = setTimeout(() => setControlsShown(false), CONTROLS_HIDE_MS);
    return () => clearTimeout(timer);
  }, [autoHide, setControlsShown]);
  // Loading keeps the picture clear for zapping; states that need a decision
  // (error, timeout, paused, cellular...) always bring the controls back.
  const loading = ["checking", "connecting", "buffering"].includes(state.phase);
  const controlsVisible =
    controlsShown ||
    props.sheetOpen ||
    screenReader ||
    (state.phase !== "playing" && !loading);

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
  const primaryLabel =
    state.phase === "cellular"
      ? "继续播放"
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
      props.onMobileAccepted?.();
      onUserPlay();
      void controller.requestPlay(true);
      return;
    }
    const id = state.attemptId;
    // Catch-up streams pause in place so the position survives. Plain live
    // stops (releasing the decoder); resuming reconnects at the live edge.
    if (
      id !== null &&
      (state.phase === "playing" || state.phase === "buffering") &&
      mediaInfo.seekable &&
      media.pause()
    ) {
      if (!controller.userPaused(id)) controller.pause();
      return;
    }
    if (retained && media.play()) return;
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
        ? "被其他应用打断"
        : "";
  // One round control for the primary action in every state, so cancel,
  // retry, pause and resume all look alike: ■ while connecting, ↻ after a
  // failure, ▶ when paused or stopped, ❚❚ while playing.
  const showsPlay = retained || !busy;
  const primaryIcon = starting ? "■" : canRetry ? "↻" : showsPlay ? "▶" : "❚❚";
  const primaryDisabled = !props.remoteAllowed;
  // The one visual focus of the overlay: previous / play-pause / next in a
  // row, the same in portrait (smaller) and fullscreen. Also shown inside the
  // status notice, so stopped and paused states keep the same controls.
  const compactCluster = !props.fullscreen;
  const zapCluster = (absolute: boolean) => (
    <View
      testID="zap-cluster"
      style={[styles.zapRow, absolute && styles.zapRowAbsolute]}
      pointerEvents="box-none"
    >
      <OverlayButton
        label="⏮"
        accessibilityLabel="上一台"
        variant="ring"
        compact={compactCluster}
        disabled={previous === null}
        onPress={() => {
          if (previous !== null) props.onSelect(props.channels[previous]);
        }}
      />
      <Pressable
        testID="center-play-pause"
        style={({ pressed }) => [
          styles.centerButton,
          compactCluster && styles.centerButtonCompact,
          pressed && styles.pressed,
          primaryDisabled && styles.overlayButtonDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
        accessibilityState={{ disabled: primaryDisabled }}
        onPress={primaryAction}
        disabled={primaryDisabled}
      >
        <Text style={styles.centerIcon}>{primaryIcon}</Text>
      </Pressable>
      <OverlayButton
        label="⏭"
        accessibilityLabel="下一台"
        variant="ring"
        compact={compactCluster}
        disabled={next === null}
        onPress={selectNext}
      />
    </View>
  );
  // Quality and source of the address that is actually playing; the chip opens
  // the alternatives (a popover in fullscreen, a bottom sheet in portrait).
  const sourceButton = (
    <SourceChip
      quality={qualityName(props.channel)}
      sourceName={props.channel.sourceName}
      count={props.sources.length}
      accessibilityLabel={
        props.sources.length > 1
          ? `来源：${qualityName(props.channel)} · ${props.channel.sourceName}，共 ${props.sources.length} 个，点击切换`
          : `来源：${qualityName(props.channel)} · ${props.channel.sourceName}`
      }
      solid={!props.fullscreen}
      disabled={props.sources.length < 2}
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
    zapCluster,
    sourceButton,
    favoriteButton,
  };
}

export type SessionView = ReturnType<typeof useChannelSession>;

const styles = StyleSheet.create({
  centerButton: {
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00000073",
    borderWidth: 1,
    borderColor: "#FFFFFF40",
  },
  centerButtonCompact: { width: 56, height: 56, borderRadius: 28 },
  zapRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 22,
  },
  zapRowAbsolute: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  centerIcon: { color: colors.text, fontSize: 24, lineHeight: 30 },
  favoriteHit: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  favoriteSolid: { borderRadius: 12, backgroundColor: colors.raised },
  overlayButtonDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  star: { color: colors.muted, fontSize: 20, lineHeight: 24 },
  starOn: { color: colors.warn },
});
