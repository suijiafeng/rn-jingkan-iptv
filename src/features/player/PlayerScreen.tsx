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
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { NavigationBar } from "expo-navigation-bar";
import * as Network from "expo-network";
import * as Orientation from "expo-screen-orientation";
import { GroupTabs } from "../../components/GroupTabs";
import { Button, Heading } from "../../components/ui";
import { colors, styles as theme } from "../../theme";
import type { Channel } from "../../domain/types";
import {
  channelTitle,
  displayGroups,
  splitGroups,
} from "../../domain/channelLabels";
import { NativeAttempt } from "./NativeAttempt";
import {
  adjacentChannelIndex,
  backDestination,
  PlaybackController,
  type PlaybackSnapshot,
} from "./playbackController";

export interface PlayerScreenProps {
  channel: Channel;
  channels: Channel[];
  /** Full catalog for the channel sheet; channels remains the playback queue. */
  allChannels?: Channel[];
  /** SQLite history in most-recent-first order, including inactive channels. */
  recentChannels?: Channel[];
  onSelect: (channel: Channel, queue?: Channel[]) => void;
  onClose: () => void;
  onFavorite: (channel: Channel) => void;
  onStarted: (channel: Channel) => void;
  remoteAllowed: boolean;
  mobileWarning: boolean;
  /** The user chose to continue on a possibly metered network. */
  onMobileAccepted?: () => void;
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

/** Fullscreen and sheet belong to the screen, not to the replaceable channel. */
export function PlayerScreen(props: PlayerScreenProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "favorites" | "recent">("all");
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [locateRequest, setLocateRequest] = useState(0);
  const { width } = useWindowDimensions();
  const channelList = useRef<FlatList<Channel>>(null);
  const savedSheetPosition = useRef<{
    range: string;
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
  const allActiveChannels = useMemo(
    () =>
      (props.allChannels ?? props.channels).filter((channel) => channel.active),
    [props.allChannels, props.channels],
  );
  const scopeChannels = useMemo(
    () =>
      scope === "recent"
        ? (props.recentChannels ?? [])
        : scope === "favorites"
          ? allActiveChannels.filter((channel) => channel.favorite)
          : allActiveChannels,
    [scope, props.recentChannels, allActiveChannels],
  );
  const groups = useMemo(
    () => [
      ...new Set(
        allActiveChannels.flatMap((channel) => splitGroups(channel.groupName)),
      ),
    ],
    [allActiveChannels],
  );
  const query = search.trim().toLocaleLowerCase();
  const shownChannels = useMemo(
    () =>
      scopeChannels.filter(
        (channel) =>
          (scope !== "all" ||
            !group ||
            splitGroups(channel.groupName).includes(group)) &&
          (!query ||
            `${channel.name} ${displayGroups(channel.groupName)} ${channel.sourceName}`
              .toLocaleLowerCase()
              .includes(query)),
      ),
    [scopeChannels, scope, query, group],
  );
  const range = JSON.stringify([scope, query, group]);
  const currentIndex = shownChannels.findIndex(
    (channel) => channel.id === props.channel.id,
  );
  const currentInCatalog = allActiveChannels.some(
    (channel) => channel.id === props.channel.id,
  );
  const lastLocateRequest = useRef(0);
  const changeScope = (next: typeof scope) => {
    if (next === scope) return;
    Keyboard.dismiss();
    setScope(next);
    setSearch("");
    setGroup(null);
  };
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
          setFullscreen((value) => !value);
        }}
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
                accessibilityState={{ disabled: !currentInCatalog }}
                disabled={!currentInCatalog}
                onPress={() => {
                  Keyboard.dismiss();
                  if (currentIndex < 0) {
                    setScope("all");
                    setSearch("");
                    setGroup(null);
                  }
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
            <View style={s.searchRow}>
              <TextInput
                style={s.searchInput}
                accessibilityLabel="搜索选台频道"
                placeholder="搜索频道、分组或来源"
                placeholderTextColor={colors.muted}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={Keyboard.dismiss}
              />
              {!!search && (
                <Pressable
                  style={s.favoriteHit}
                  accessibilityRole="button"
                  accessibilityLabel="清除选台搜索"
                  onPress={() => setSearch("")}
                >
                  <Text style={s.sheetAction}>清除</Text>
                </Pressable>
              )}
            </View>
            {scope === "all" && (
              <GroupTabs
                groups={groups}
                selected={group}
                onChange={(nextGroup) => {
                  Keyboard.dismiss();
                  setGroup(nextGroup);
                }}
                buttonStyle={s.sheetButton}
                testID="player-group-tabs"
              />
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
                <Text style={s.empty}>
                  {query || (scope === "all" && group)
                    ? `没有匹配频道，试试清除搜索${scope === "all" ? "或切换分组" : ""}`
                    : scope === "recent"
                      ? "还没有最近观看记录"
                      : scope === "favorites"
                        ? "还没有收藏的可用频道"
                        : "没有可用频道"}
                </Text>
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    s.channelRow,
                    item.id === props.channel.id && s.selectedRow,
                  ]}
                >
                  <Pressable
                    style={[s.channelSelect, !item.active && s.inactiveChannel]}
                    accessibilityRole="button"
                    accessibilityLabel={`${channelTitle(item.name).title}，${item.sourceName}${item.id === props.channel.id ? "，当前频道" : ""}`}
                    accessibilityState={{
                      selected: item.id === props.channel.id,
                      disabled: !item.active,
                    }}
                    disabled={!item.active}
                    onPress={() => {
                      setSheetOpen(false);
                      props.onSelect(
                        item,
                        shownChannels.filter((channel) => channel.active),
                      );
                    }}
                  >
                    <View style={s.channelMark}>
                      <Text style={s.markText}>
                        {Array.from(channelTitle(item.name).title)[0] || "台"}
                      </Text>
                    </View>
                    <View style={s.flex}>
                      <Text numberOfLines={1} style={theme.heading}>
                        {channelTitle(item.name).title}
                      </Text>
                      <Text numberOfLines={1} style={theme.muted}>
                        {!item.active
                          ? "已失效"
                          : item.id === props.channel.id
                            ? "当前频道"
                            : displayGroups(item.groupName)}{" "}
                        · {item.sourceName}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    style={s.favoriteHit}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.favorite ? "取消收藏" : "收藏"}${channelTitle(item.name).title}`}
                    accessibilityState={{ selected: item.favorite }}
                    onPress={() => props.onFavorite(item)}
                  >
                    <Text style={[s.star, item.favorite && s.accent]}>
                      {item.favorite ? "★" : "☆"}
                    </Text>
                  </Pressable>
                </View>
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
  const [controlsShown, setControlsShown] = useState(true);
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
  }, [autoHide]);
  const controlsVisible =
    !props.fullscreen ||
    controlsShown ||
    props.sheetOpen ||
    screenReader ||
    state.phase !== "playing";
  // Entering or leaving fullscreen always starts with the controls shown.
  const [lastFullscreen, setLastFullscreen] = useState(props.fullscreen);
  if (lastFullscreen !== props.fullscreen) {
    setLastFullscreen(props.fullscreen);
    setControlsShown(true);
  }

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
  const previous = adjacentChannelIndex(props.channels.length, index, -1);
  const next = adjacentChannelIndex(props.channels.length, index, 1);
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
      onPress={() => {
        if (next !== null) props.onSelect(props.channels[next]);
      }}
    />
  );

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
          <Pressable
            testID="fullscreen-toggle-controls"
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel={
              controlsVisible ? "隐藏播放控件" : "显示播放控件"
            }
            onPress={() => setControlsShown(!controlsVisible)}
          />
        )}
        {state.phase !== "playing" && (
          <View style={s.videoNotice} accessibilityLiveRegion="polite">
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
          {channelTitle(props.channel.name).title}
        </Text>
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
  searchRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: colors.raised,
  },
  searchInput: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 14,
  },
  channelList: { flex: 1 },
  listContent: { gap: 4 },
  channelRow: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    paddingLeft: 12,
    borderWidth: 1,
    borderColor: "transparent",
  },
  selectedRow: { borderColor: colors.line },
  inactiveChannel: { opacity: 0.5 },
  channelSelect: {
    flex: 1,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  channelMark: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.raised,
  },
  markText: { color: colors.accent, fontSize: 18, fontWeight: "500" },
  favoriteHit: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  star: { color: colors.muted, fontSize: 24 },
  accent: { color: colors.accent },
  empty: { color: colors.muted, paddingVertical: 24, textAlign: "center" },
  warning: { color: colors.warn, fontSize: 12, lineHeight: 18 },
});
