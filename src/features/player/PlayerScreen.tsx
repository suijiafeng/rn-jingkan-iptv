import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Network from "expo-network";
import * as Orientation from "expo-screen-orientation";
import { Button, Heading } from "../../components/ui";
import { colors, styles as theme } from "../../theme";
import type { Channel } from "../../domain/types";
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
  onSelect: (channel: Channel) => void;
  onClose: () => void;
  onFavorite: (channel: Channel) => void;
  onStarted: (channel: Channel) => void;
  remoteAllowed: boolean;
  mobileWarning: boolean;
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
    body: "当前网络可能产生流量费用。是否继续播放？",
  },
  blocked: {
    title: "外部连接已关闭",
    body: "返回设置，允许连接自己的节目源后再播放",
  },
  offline: { title: "网络未连接", body: "检查网络连接，然后手动重试" },
  timeout: {
    title: "连接超时",
    body: "30 秒内未开始播放。可以重试或换一个频道",
  },
  error: {
    title: "暂时无法播放",
    body: "原因未确定，播放器未提供可靠的细分原因。请重试或联系节目源提供方",
  },
  ended: { title: "节目流已结束", body: "可以重试连接，或选择其他频道" },
};

/** Fullscreen and sheet belong to the screen, not to the replaceable channel. */
export function PlayerScreen(props: PlayerScreenProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
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
  const shownChannels = favoritesOnly
    ? activeChannels.filter((channel) => channel.favorite)
    : activeChannels;
  return (
    <SafeAreaView
      style={s.screen}
      edges={
        fullscreen ? ["left", "right"] : ["top", "left", "right", "bottom"]
      }
    >
      <StatusBar style="light" hidden={fullscreen} />
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
            accessibilityRole="button"
            accessibilityLabel="关闭频道列表"
            onPress={() => setSheetOpen(false)}
          />
          <View style={[s.sheet, fullscreen && s.landscapeSheet]}>
            <View style={s.sheetHandle} />
            <Heading
              title="选择频道"
              subtitle={`当前 · ${props.channel.name}`}
            />
            <Text style={theme.muted}>点选立即换台 · 播放状态以播放器为准</Text>
            <View style={s.row}>
              <View style={s.flex}>
                <Button
                  label="全部频道"
                  secondary={favoritesOnly}
                  onPress={() => setFavoritesOnly(false)}
                />
              </View>
              <View style={s.flex}>
                <Button
                  label="收藏频道"
                  secondary={!favoritesOnly}
                  onPress={() => setFavoritesOnly(true)}
                />
              </View>
            </View>
            <FlatList
              data={shownChannels}
              keyExtractor={(item) => item.id}
              style={s.channelList}
              contentContainerStyle={s.listContent}
              ListEmptyComponent={
                <Text style={s.empty}>还没有收藏的可用频道</Text>
              }
              renderItem={({ item }) => (
                <View
                  style={[
                    s.channelRow,
                    item.id === props.channel.id && s.selectedRow,
                  ]}
                >
                  <Pressable
                    style={s.channelSelect}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name}，${item.sourceName}${item.id === props.channel.id ? "，当前频道" : ""}`}
                    accessibilityState={{
                      selected: item.id === props.channel.id,
                    }}
                    onPress={() => {
                      setSheetOpen(false);
                      if (item.id !== props.channel.id) props.onSelect(item);
                    }}
                  >
                    <View style={s.channelMark}>
                      <Text style={s.markText}>
                        {Array.from(item.name)[0] || "台"}
                      </Text>
                    </View>
                    <View style={s.flex}>
                      <Text numberOfLines={1} style={theme.heading}>
                        {item.name}
                      </Text>
                      <Text numberOfLines={1} style={theme.muted}>
                        {item.id === props.channel.id
                          ? "当前频道"
                          : item.groupName || "未分组"}{" "}
                        · {item.sourceName}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    style={s.favoriteHit}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.favorite ? "取消收藏" : "收藏"}${item.name}`}
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
            <Button
              label="关闭频道列表"
              secondary
              onPress={() => setSheetOpen(false)}
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
          title={props.channel.name}
          subtitle={`${props.channel.sourceName} · ${props.channel.groupName || "未分组"}`}
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
        {state.phase !== "playing" && (
          <View style={s.videoNotice} accessibilityLiveRegion="polite">
            {waiting && <ActivityIndicator color={colors.accent} />}
            <Text style={s.noticeTitle}>{description.title}</Text>
            <Text style={s.noticeBody}>
              {state.phase === "paused" ? pausedBody : description.body}
            </Text>
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
                      void controller.requestPlay(true);
                    }}
                  />
                </View>
              </View>
            )}
          </View>
        )}
      </View>
      <View style={props.fullscreen ? s.fullscreenTop : s.hidden}>
        <Button label="退出全屏" secondary onPress={props.onToggleFullscreen} />
        <Text style={[theme.heading, s.flex]} numberOfLines={1}>
          {props.channel.name}
        </Text>
        <Text style={theme.muted}>{description.title}</Text>
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
        <Pressable
          style={s.quiet}
          accessibilityRole="button"
          accessibilityLabel={
            props.channel.favorite ? "取消收藏当前频道" : "收藏当前频道"
          }
          accessibilityState={{ selected: props.channel.favorite }}
          onPress={() => props.onFavorite(props.channel)}
        >
          <Text style={s.quietText}>
            {props.channel.favorite ? "★ 已收藏" : "☆ 收藏频道"}
          </Text>
        </Pressable>
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
      <View style={props.fullscreen ? s.fullscreenBottom : s.hidden}>
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
    backgroundColor: "#00000088",
    justifyContent: "flex-end",
    alignItems: "flex-end",
  },
  sheet: {
    width: "100%",
    height: "74%",
    maxHeight: "94%",
    padding: 20,
    paddingBottom: 24,
    gap: 12,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.surface,
  },
  landscapeSheet: {
    maxWidth: 560,
    height: "94%",
    paddingTop: 12,
    paddingBottom: 12,
    gap: 8,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    backgroundColor: colors.line,
  },
  channelList: { flex: 1 },
  listContent: { gap: 8 },
  channelRow: {
    minHeight: 80,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    paddingLeft: 12,
    borderWidth: 1,
    borderColor: "transparent",
  },
  selectedRow: { borderColor: colors.line },
  channelSelect: {
    flex: 1,
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  channelMark: {
    width: 44,
    height: 44,
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
