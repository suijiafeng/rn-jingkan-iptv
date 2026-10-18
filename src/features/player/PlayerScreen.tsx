import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  BackHandler,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { NavigationBar } from "expo-navigation-bar";
import * as Network from "expo-network";
import * as Orientation from "expo-screen-orientation";
import { ChannelRow } from "../../components/ChannelRow";
import {
  ChannelFilterBar,
  type HeaderProps,
  type ListTab,
} from "../channel/ChannelListParts";
import { Button, Heading, Notice } from "../../components/ui";
import { colors, styles as theme } from "../../theme";
import type { Channel } from "../../domain/types";
import { channelTitle, displayGroups } from "../../domain/channelLabels";
import { NativeAttempt } from "./NativeAttempt";
import {
  adjacentPlayableIndex,
  backDestination,
  PlaybackController,
  type PlaybackSnapshot,
} from "./playbackController";

/** The channel page's list and filters, shown in the player's channel sheet. */
export interface ChannelSheetProps {
  /** The page's filter state (tab, search, source, facets); one shared state. */
  filters: HeaderProps;
  onTabChange: (tab: ListTab) => void;
  /** The page's current result in its order (unavailable channels last). */
  channels: Channel[];
  /** Identifies the shown result; null while the next one is loading. */
  rangeKey: string | null;
  loading: boolean;
  /** Show everything (country bypassed) so the playing channel is listed. */
  onLocate: () => void;
}

export interface PlayerScreenProps {
  channel: Channel;
  channels: Channel[];
  /** The channel page's list and filters; channels remains the playback queue. */
  sheet: ChannelSheetProps;
  onSelect: (channel: Channel, queue?: Channel[]) => void;
  onClose: () => void;
  onFavorite: (channel: Channel) => void;
  onStarted: (channel: Channel) => void;
  remoteAllowed: boolean;
  mobileWarning: boolean;
  /** The user chose to continue on a possibly metered network. */
  onMobileAccepted?: () => void;
  /** Fullscreen swipe up = next channel; true flips it (我的电视 “换台反转”). */
  swipeReverse?: boolean;
  /** Previous/next step over channels the last manual check found unreachable. */
  skipUnreachable?: boolean;
  /** The channel watched just before this one, for a one-tap return. */
  previousChannel?: Channel | null;
  artworkEnabled?: boolean;
  error?: string;
  onDismissError?: () => void;
}

const descriptions: Record<
  PlaybackSnapshot["phase"],
  { title: string; body: string }
> = {
  paused: { title: "已暂停", body: "点击播放，继续收看当前频道" },
  checking: { title: "正在检查网络", body: "确认连接后开始播放" },
  connecting: { title: "正在连接频道", body: "首次加载最多等待 30 秒" },
  playing: { title: "正在播放", body: "画面来自你的节目源" },
  buffering: { title: "正在缓冲", body: "等待节目源传送画面" },
  cellular: {
    title: "可能使用移动数据",
    body: "当前网络可能产生流量费用。继续后，连回 Wi-Fi 之前不再询问。",
  },
  blocked: {
    title: "外部连接已关闭",
    body: "返回设置，允许连接自己的节目源后再播放",
  },
  offline: { title: "网络未连接", body: "检查网络连接，然后手动重试" },
  timeout: {
    title: "连接超时",
    body: "30 秒内未开始播放。节目源可能已失效、受地区限制或暂时不可用。可以重试、换台，或在来源管理中检测可用性",
  },
  error: {
    title: "暂时无法播放",
    body: "原因未确定（播放器没有提供可靠的细分原因）。常见情况：地址失效、地区限制、服务器拒绝或格式不支持。可以重试、换台，或在来源管理中检测可用性",
  },
  ended: { title: "节目流已结束", body: "可以重试连接，或选择其他频道" },
};

export const CONTROLS_HIDE_MS = 4000;
/** Channel name/position overlay after a switch in fullscreen. */
export const OSD_MS = 2500;
/** After this long without a picture, suggest moving on (spec: prompt at 15 s). */
export const SLOW_START_SECONDS = 15;
/** Minimum vertical travel (dp) for a fullscreen swipe to change channel. */
export const SWIPE_MIN_DP = 60;
const TAP_SLOP_DP = 12;

/** Fullscreen and sheet belong to the screen, not to the replaceable channel. */
export function PlayerScreen(props: PlayerScreenProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Lives above the per-channel session so zapping keeps hidden controls hidden.
  const [controlsShown, setControlsShown] = useState(true);
  const [locateRequest, setLocateRequest] = useState(0);
  const { width } = useWindowDimensions();
  const channelList = useRef<FlatList<Channel>>(null);
  const savedSheetPosition = useRef<{
    range: string | null;
    channelId: string;
    offset: number;
  } | null>(null);
  const scrollRetry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTarget = useRef<{ index: number; retries: number } | null>(null);
  const [orientationError, setOrientationError] = useState(false);
  const originalLock = useRef<Orientation.OrientationLock>(
    Orientation.OrientationLock.DEFAULT,
  );
  const orientationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    orientationQueue.current = Orientation.getOrientationLockAsync()
      .then((lock) => {
        originalLock.current = lock;
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      // Serialize restoration behind any pending rotate operation.
      orientationQueue.current = orientationQueue.current
        .then(() => Orientation.lockAsync(originalLock.current))
        .catch(() => {});
    };
  }, []);
  useEffect(() => {
    orientationQueue.current = orientationQueue.current
      .then(() => {
        if (!mounted.current) return;
        return Orientation.lockAsync(
          fullscreen
            ? Orientation.OrientationLock.LANDSCAPE
            : Orientation.OrientationLock.PORTRAIT_UP,
        );
      })
      .catch(() => {
        if (mounted.current) setOrientationError(true);
      });
  }, [fullscreen]);

  const onClose = props.onClose;
  const handleBack = useCallback(() => {
    const destination = backDestination(sheetOpen, fullscreen);
    if (destination === "sheet") setSheetOpen(false);
    else if (destination === "fullscreen") setFullscreen(false);
    else onClose();
    return true;
  }, [sheetOpen, fullscreen, onClose]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      handleBack,
    );
    return () => subscription.remove();
  }, [handleBack]);

  const activeChannels = useMemo(
    () => props.channels.filter((channel) => channel.active),
    [props.channels],
  );
  const sheet = props.sheet;
  const scope = sheet.filters.tab;
  const shownChannels = sheet.channels;
  const range = sheet.rangeKey;
  const currentIndex = shownChannels.findIndex(
    (channel) => channel.id === props.channel.id,
  );
  const lastLocateRequest = useRef(0);
  const changeScope = (next: ListTab) => {
    if (next === scope) return;
    Keyboard.dismiss();
    sheet.onTabChange(next);
  };
  const selectFromSheet = (item: Channel) => {
    setSheetOpen(false);
    props.onSelect(
      item,
      shownChannels.filter((channel) => channel.active),
    );
  };
  const filtered =
    !!sheet.filters.search ||
    (scope === "all" &&
      (!!sheet.filters.sourceId ||
        Object.values(sheet.filters.facetSelection).some((v) => v !== null)));
  useEffect(() => {
    if (!sheetOpen) return;
    const previous = savedSheetPosition.current;
    const forceLocate = lastLocateRequest.current !== locateRequest;
    lastLocateRequest.current = locateRequest;
    if (
      !forceLocate &&
      previous?.range === range &&
      previous.channelId === props.channel.id
    ) {
      channelList.current?.scrollToOffset({
        offset: previous.offset,
        animated: false,
      });
    } else {
      savedSheetPosition.current = {
        range,
        channelId: props.channel.id,
        offset: 0,
      };
      if (currentIndex >= 0) {
        scrollTarget.current = { index: currentIndex, retries: 2 };
        channelList.current?.scrollToIndex({
          index: currentIndex,
          viewPosition: 0.35,
          animated: false,
        });
      } else {
        channelList.current?.scrollToOffset({ offset: 0, animated: false });
      }
    }
    return () => {
      if (scrollRetry.current !== null) clearTimeout(scrollRetry.current);
      scrollTarget.current = null;
    };
  }, [sheetOpen, range, props.channel.id, currentIndex, locateRequest]);
  return (
    <SafeAreaView
      style={s.screen}
      edges={
        fullscreen ? ["left", "right"] : ["top", "left", "right", "bottom"]
      }
    >
      <StatusBar style="light" hidden={fullscreen} />
      {/* Immersive: system bars reappear transiently on an edge swipe. */}
      <NavigationBar hidden={fullscreen} />
      <ChannelSession
        key={`${props.channel.id}:${props.channel.streamUrl}`}
        {...props}
        channels={activeChannels}
        fullscreen={fullscreen}
        onToggleFullscreen={() => {
          setOrientationError(false);
          // Entering or leaving fullscreen always starts with the controls shown.
          setControlsShown(true);
          setFullscreen((value) => !value);
        }}
        controlsShown={controlsShown}
        onControlsShownChange={setControlsShown}
        onOpenSheet={() => setSheetOpen(true)}
        orientationError={orientationError}
        sheetOpen={sheetOpen}
      />
      {sheetOpen && (
        <View style={s.sheetOverlay} accessibilityViewIsModal>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessible={false}
            importantForAccessibility="no"
            onPress={() => setSheetOpen(false)}
          />
          <View
            style={[
              s.sheet,
              fullscreen && s.landscapeSheet,
              fullscreen && {
                width: Math.min(width, Math.max(280, width * 0.4), 440),
              },
            ]}
          >
            <View style={s.sheetHeading}>
              <View style={s.flex}>
                <Text accessibilityRole="header" style={theme.heading}>
                  选择频道
                </Text>
                <Text numberOfLines={1} style={theme.muted}>
                  当前 · {channelTitle(props.channel.name).title}
                </Text>
              </View>
              <Pressable
                style={s.favoriteHit}
                accessibilityRole="button"
                accessibilityLabel="定位当前频道"
                accessibilityState={{ disabled: !props.channel.active }}
                disabled={!props.channel.active}
                onPress={() => {
                  Keyboard.dismiss();
                  if (currentIndex < 0) sheet.onLocate();
                  setLocateRequest((value) => value + 1);
                }}
              >
                <Text style={s.sheetAction}>定位</Text>
              </Pressable>
              <Pressable
                style={s.favoriteHit}
                accessibilityRole="button"
                accessibilityLabel="关闭频道列表"
                onPress={() => setSheetOpen(false)}
              >
                <Text style={s.sheetAction}>关闭</Text>
              </Pressable>
            </View>
            <View style={s.sheetScopes} testID="player-scopes">
              {(
                [
                  ["all", "频道"],
                  ["favorites", "收藏"],
                  ["recent", "最近"],
                ] as const
              ).map(([value, label]) => (
                <View key={value} style={s.flex}>
                  <Button
                    label={label}
                    secondary={scope !== value}
                    selected={scope === value}
                    style={s.sheetButton}
                    onPress={() => changeScope(value)}
                  />
                </View>
              ))}
            </View>
            <ChannelFilterBar
              key={scope}
              {...sheet.filters}
              idPrefix="player"
              compact
            />
            {!!props.error && (
              <View>
                <Notice title={props.error} error />
                <Button
                  secondary
                  label="关闭选台提示"
                  onPress={() => props.onDismissError?.()}
                />
              </View>
            )}
            <FlatList
              ref={channelList}
              testID="player-channel-list"
              data={shownChannels}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onScroll={(event) => {
                savedSheetPosition.current = {
                  range,
                  channelId: props.channel.id,
                  offset: event.nativeEvent.contentOffset.y,
                };
              }}
              scrollEventThrottle={32}
              onScrollBeginDrag={() => {
                if (scrollRetry.current !== null)
                  clearTimeout(scrollRetry.current);
                scrollTarget.current = null;
              }}
              onScrollToIndexFailed={({ index, averageItemLength }) => {
                const target = scrollTarget.current;
                if (!target || target.index !== index) return;
                channelList.current?.scrollToOffset({
                  offset: Math.max(0, averageItemLength * index),
                  animated: false,
                });
                if (target.retries <= 0) return;
                target.retries -= 1;
                if (scrollRetry.current !== null)
                  clearTimeout(scrollRetry.current);
                scrollRetry.current = setTimeout(() => {
                  scrollRetry.current = null;
                  if (scrollTarget.current === target) {
                    channelList.current?.scrollToIndex({
                      index,
                      viewPosition: 0.35,
                      animated: false,
                    });
                  }
                }, 100);
              }}
              keyExtractor={(item) => item.id}
              style={s.channelList}
              contentContainerStyle={s.listContent}
              ListEmptyComponent={
                sheet.loading ? (
                  <ActivityIndicator
                    style={s.emptyLoading}
                    color={colors.accent}
                  />
                ) : (
                  <Text style={s.empty}>
                    {filtered
                      ? `没有匹配频道，试试清除搜索${scope === "all" ? "或调整筛选" : ""}`
                      : scope === "recent"
                        ? "还没有最近观看记录"
                        : scope === "favorites"
                          ? "还没有收藏的可用频道"
                          : "没有可用频道"}
                  </Text>
                )
              }
              renderItem={({ item }) => (
                <ChannelRow
                  channel={item}
                  current={item.id === props.channel.id}
                  onPlay={selectFromSheet}
                  onFavorite={props.onFavorite}
                  artworkEnabled={!!props.artworkEnabled && props.remoteAllowed}
                  flat
                />
              )}
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

interface SessionProps extends PlayerScreenProps {
  fullscreen: boolean;
  sheetOpen: boolean;
  controlsShown: boolean;
  onControlsShownChange: (shown: boolean) => void;
  onToggleFullscreen: () => void;
  onOpenSheet: () => void;
  orientationError: boolean;
}

function ChannelSession(props: SessionProps) {
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

  // Fullscreen controls: tap the picture to toggle; they auto-hide only while
  // actually playing, and never for screen-reader users.
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
    props.fullscreen &&
    controlsShown &&
    !props.sheetOpen &&
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
    !props.fullscreen ||
    controlsShown ||
    props.sheetOpen ||
    screenReader ||
    (state.phase !== "playing" && !loading);

  const busy = ["checking", "connecting", "playing", "buffering"].includes(
    state.phase,
  );
  const waiting = ["checking", "connecting", "buffering"].includes(state.phase);
  const canRetry = ["offline", "timeout", "error", "ended"].includes(
    state.phase,
  );
  const primaryLabel = busy ? "暂停" : canRetry ? "重试播放" : "播放";
  const primaryAction = () => {
    if (busy) controller.pause();
    else void controller.requestPlay();
  };
  const index = props.channels.findIndex(
    (channel) => channel.id === props.channel.id,
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
  const gesture = useRef<{ x: number; y: number } | null>(null);

  const description = descriptions[state.phase];
  const pausedBody =
    state.pauseReason === "background"
      ? "离开应用后已暂停。点击播放继续收看"
      : state.pauseReason === "interrupted"
        ? "播放已被系统暂停。点击播放继续收看"
        : state.pauseReason === "cellular-declined"
          ? "已停止播放。准备好后可手动播放"
          : description.body;
  const playButton = (
    <Button
      label={primaryLabel}
      onPress={primaryAction}
      disabled={!props.remoteAllowed || state.phase === "cellular"}
    />
  );
  const previousButton = (
    <Button
      label="上一台"
      secondary
      disabled={previous === null}
      onPress={() => {
        if (previous !== null) props.onSelect(props.channels[previous]);
      }}
    />
  );
  const nextButton = (
    <Button
      label="下一台"
      secondary
      disabled={next === null}
      onPress={selectNext}
    />
  );
  const previousChannel =
    props.previousChannel &&
    props.previousChannel.active &&
    props.previousChannel.id !== props.channel.id
      ? props.previousChannel
      : null;

  const favoriteButton = (
    <Pressable
      style={props.fullscreen ? s.favoriteHit : s.quiet}
      accessibilityRole="button"
      accessibilityLabel={
        props.channel.favorite ? "取消收藏当前频道" : "收藏当前频道"
      }
      accessibilityState={{ selected: props.channel.favorite }}
      onPress={() => props.onFavorite(props.channel)}
    >
      <Text
        style={
          props.fullscreen
            ? [s.star, props.channel.favorite && s.accent]
            : s.quietText
        }
      >
        {props.fullscreen
          ? props.channel.favorite
            ? "★"
            : "☆"
          : props.channel.favorite
            ? "★ 已收藏"
            : "☆ 收藏频道"}
      </Text>
    </Pressable>
  );

  return (
    <ScrollView
      style={s.flex}
      contentContainerStyle={[
        s.content,
        props.fullscreen && s.fullscreenContent,
      ]}
      scrollEnabled={!props.fullscreen}
      importantForAccessibility={
        props.sheetOpen ? "no-hide-descendants" : "auto"
      }
      accessibilityElementsHidden={props.sheetOpen}
    >
      <View style={props.fullscreen ? s.hidden : undefined}>
        <Heading
          title={channelTitle(props.channel.name).title}
          subtitle={[
            props.channel.sourceName,
            displayGroups(props.channel.groupName),
            ...channelTitle(props.channel.name).tags,
          ].join(" · ")}
        />
      </View>
      <View style={[s.videoStage, props.fullscreen && s.fullscreenVideo]}>
        {props.remoteAllowed && state.attemptId !== null && (
          <NativeAttempt
            key={state.attemptId}
            uri={props.channel.streamUrl}
            attemptId={state.attemptId}
            controller={controller}
          />
        )}
        {props.fullscreen && (
          <View
            testID="fullscreen-gesture-layer"
            style={StyleSheet.absoluteFill}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`${title}，轻触${controlsVisible ? "隐藏" : "显示"}播放控件，上下滑动换台`}
            accessibilityActions={[
              {
                name: "activate",
                label: controlsVisible ? "隐藏播放控件" : "显示播放控件",
              },
              { name: "increment", label: "下一台" },
              { name: "decrement", label: "上一台" },
            ]}
            onAccessibilityAction={({ nativeEvent }) => {
              if (nativeEvent.actionName === "activate")
                setControlsShown(!controlsVisible);
              else if (nativeEvent.actionName === "increment") zap(1);
              else if (nativeEvent.actionName === "decrement") zap(-1);
            }}
            onStartShouldSetResponder={() => true}
            onResponderGrant={({ nativeEvent }) => {
              gesture.current = { x: nativeEvent.pageX, y: nativeEvent.pageY };
            }}
            onResponderTerminate={() => {
              gesture.current = null;
            }}
            onResponderRelease={({ nativeEvent }) => {
              const start = gesture.current;
              gesture.current = null;
              if (!start) return;
              const dx = nativeEvent.pageX - start.x;
              const dy = nativeEvent.pageY - start.y;
              if (
                Math.abs(dy) >= SWIPE_MIN_DP &&
                Math.abs(dy) > Math.abs(dx) * 1.5
              )
                zap(dy < 0 ? 1 : -1);
              else if (Math.abs(dx) < TAP_SLOP_DP && Math.abs(dy) < TAP_SLOP_DP)
                setControlsShown(!controlsVisible);
            }}
          />
        )}
        {props.fullscreen && osd && !props.sheetOpen && (
          <View style={s.osd} pointerEvents="none" testID="channel-osd">
            <Text style={s.osdText} numberOfLines={1}>
              {osd}
            </Text>
          </View>
        )}
        {state.phase !== "playing" && (
          // box-none: swipes on the dimmed area still reach the gesture layer.
          <View
            style={s.videoNotice}
            pointerEvents="box-none"
            accessibilityLiveRegion="polite"
          >
            <View pointerEvents="none" style={s.noticeText}>
              {waiting && <ActivityIndicator color={colors.accent} />}
              <Text style={s.noticeTitle}>{description.title}</Text>
              <Text style={s.noticeBody}>
                {state.phase === "paused" ? pausedBody : description.body}
              </Text>
              {(state.phase === "timeout" || state.phase === "error") &&
                props.channel.checkStatus === "unreachable" && (
                  <Text style={s.noticeBody}>
                    上次可用性检测时，这个地址也没有响应。
                  </Text>
                )}
            </View>
            {waiting && (
              <WaitProgress
                key={state.attemptId ?? "checking"}
                onNext={
                  next !== null && props.fullscreen && !controlsVisible
                    ? selectNext
                    : undefined
                }
              />
            )}
            {state.phase === "cellular" && (
              <View style={s.row}>
                <View style={s.flex}>
                  <Button
                    label="暂不播放"
                    secondary
                    onPress={() => controller.pause("cellular-declined")}
                  />
                </View>
                <View style={s.flex}>
                  <Button
                    label="继续播放"
                    onPress={() => {
                      props.onMobileAccepted?.();
                      void controller.requestPlay(true);
                    }}
                  />
                </View>
              </View>
            )}
          </View>
        )}
      </View>
      <View
        style={props.fullscreen && controlsVisible ? s.fullscreenTop : s.hidden}
      >
        <Button label="退出全屏" secondary onPress={props.onToggleFullscreen} />
        <Text style={[theme.heading, s.flex]} numberOfLines={1}>
          {title}
        </Text>
        {props.fullscreen && previousChannel && (
          <Button
            label="回上个台"
            secondary
            accessibilityLabel={`回到上一个频道 ${channelTitle(previousChannel.name).title}`}
            onPress={() => props.onSelect(previousChannel)}
          />
        )}
        {props.fullscreen && favoriteButton}
      </View>
      <View style={props.fullscreen ? s.hidden : s.portraitControls}>
        <Text style={theme.muted}>
          {description.title} · {props.channel.sourceName}
        </Text>
        <View style={s.row}>
          <View style={s.flex}>{playButton}</View>
          <View style={s.flex}>
            <Button
              label="横屏全屏"
              secondary
              onPress={props.onToggleFullscreen}
            />
          </View>
        </View>
        <View style={s.row}>
          <View style={s.flex}>{previousButton}</View>
          <View style={s.flex}>{nextButton}</View>
        </View>
        <Button label="打开频道列表" secondary onPress={props.onOpenSheet} />
        {previousChannel && (
          <Pressable
            style={s.quiet}
            accessibilityRole="button"
            accessibilityLabel={`回到上一个频道 ${channelTitle(previousChannel.name).title}`}
            onPress={() => props.onSelect(previousChannel)}
          >
            <Text style={s.quietText} numberOfLines={1}>
              ↩ 回到 {channelTitle(previousChannel.name).title}
            </Text>
          </Pressable>
        )}
        {!props.fullscreen && favoriteButton}
        <Pressable
          style={s.quiet}
          accessibilityRole="button"
          onPress={props.onClose}
        >
          <Text style={s.quietText}>返回频道</Text>
        </Pressable>
        {props.orientationError && (
          <Text accessibilityRole="alert" style={s.warning}>
            设备未能切换屏幕方向，可以继续播放或退出全屏。
          </Text>
        )}
      </View>
      <View
        style={
          props.fullscreen && controlsVisible ? s.fullscreenBottom : s.hidden
        }
      >
        <View style={s.flex}>{previousButton}</View>
        <View style={s.flex}>{playButton}</View>
        <View style={s.flex}>{nextButton}</View>
        <View style={s.flex}>
          <Button label="频道列表" secondary onPress={props.onOpenSheet} />
        </View>
      </View>
    </ScrollView>
  );
}

/**
 * Seconds without a picture, so a dead stream is not a silent 30 s wait.
 * Own component (keyed per attempt) so the 1 s tick re-renders only itself.
 */
function WaitProgress({ onNext }: { onNext?: () => void }) {
  const [started] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    // Chained timeouts aligned to whole seconds since start (no setInterval).
    const elapsed = Math.floor((Date.now() - started) / 1000);
    const timer = setTimeout(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      (elapsed + 1) * 1000 - (Date.now() - started),
    );
    return () => clearTimeout(timer);
  }, [started, seconds]);
  const slow = seconds >= SLOW_START_SECONDS;
  return (
    <>
      <View pointerEvents="none" style={s.noticeText}>
        {seconds > 0 && <Text style={s.noticeBody}>已等待 {seconds} 秒</Text>}
        {slow && (
          <Text style={s.noticeBody}>
            比平时慢，节目源可能已失效。可以继续等，或换下一台。
          </Text>
        )}
      </View>
      {slow && onNext && <Button label="换下一台" secondary onPress={onNext} />}
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: 20, gap: 12, flexGrow: 1, paddingBottom: 24 },
  fullscreenContent: { padding: 0, paddingBottom: 0, minHeight: "100%" },
  hidden: { display: "none" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  videoStage: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000000",
    borderRadius: 20,
    overflow: "hidden",
  },
  fullscreenVideo: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: undefined,
    aspectRatio: undefined,
    borderRadius: 0,
  },
  videoNotice: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#000000CC",
    padding: 16,
    gap: 8,
    justifyContent: "center",
  },
  noticeTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 27,
    fontWeight: "600",
    textAlign: "center",
  },
  noticeBody: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  portraitControls: { gap: 12 },
  noticeText: { gap: 8 },
  osd: {
    position: "absolute",
    top: 24,
    alignSelf: "center",
    maxWidth: "70%",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "#0A1214D9",
  },
  osdText: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 27,
    fontWeight: "600",
  },
  quiet: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  quietText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "500",
  },
  fullscreenTop: {
    position: "absolute",
    top: 16,
    left: 24,
    right: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    paddingRight: 16,
    backgroundColor: "#0A1214D9",
  },
  fullscreenBottom: {
    position: "absolute",
    bottom: 24,
    left: 24,
    right: 24,
    maxWidth: 676,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    backgroundColor: "#0A1214D9",
  },
  sheetOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#00000033",
    justifyContent: "flex-end",
    alignItems: "flex-end",
  },
  sheet: {
    width: "100%",
    height: "86%",
    maxHeight: "96%",
    padding: 12,
    paddingBottom: 16,
    gap: 8,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.surface,
  },
  landscapeSheet: {
    height: "100%",
    maxHeight: "100%",
    paddingTop: 4,
    paddingBottom: 8,
    gap: 4,
    borderTopRightRadius: 0,
    borderTopLeftRadius: 16,
    backgroundColor: "#131D23F2",
  },
  sheetHeading: { flexDirection: "row", alignItems: "center", gap: 4 },
  sheetAction: { color: colors.accent, fontSize: 13, lineHeight: 20 },
  sheetScopes: { flexDirection: "row", alignItems: "center", gap: 8 },
  sheetButton: { minHeight: 48, paddingVertical: 8, paddingHorizontal: 12 },
  channelList: { flex: 1 },
  listContent: { gap: 4 },
  favoriteHit: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  star: { color: colors.muted, fontSize: 24 },
  accent: { color: colors.accent },
  empty: { color: colors.muted, paddingVertical: 24, textAlign: "center" },
  emptyLoading: { paddingVertical: 24 },
  warning: { color: colors.warn, fontSize: 12, lineHeight: 18 },
});
