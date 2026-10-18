import React, { useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Heading } from "../../components/ui";
import { colors, styles as theme } from "../../theme";
import { qualityName } from "../../domain/channelSources";
import { channelTitle, displayGroups } from "../../domain/channelLabels";
import { NativeAttempt } from "./NativeAttempt";
import { FullscreenBars } from "./FullscreenBars";
import { MediaStatus, OverlayButton, WaitProgress } from "./overlayWidgets";
import { ChevronLeftIcon, FullscreenIcon } from "./playerIcons";
import { SourceList } from "./SourceList";
import {
  SWIPE_MIN_DP,
  TAP_SLOP_DP,
  type PlayerScreenProps,
} from "./playerShared";
import { useChannelSession } from "./useChannelSession";

export interface SessionProps extends PlayerScreenProps {
  fullscreen: boolean;
  sheetOpen: boolean;
  controlsShown: boolean;
  onControlsShownChange: (shown: boolean) => void;
  onToggleFullscreen: () => void;
  onOpenSheet: () => void;
  orientationError: boolean;
  /** Owned by the screen so the hardware back key can close the source list. */
  sourcesOpen: boolean;
  onSourcesOpenChange: (open: boolean) => void;
  mini: boolean;
}

/** One channel's playback: owns the controller and native attempt; renders
 * the picture with its overlay in portrait, fullscreen and docked layouts. */
export function ChannelSession(props: SessionProps) {
  const view = useChannelSession(props);
  // Touch start of the current drag on the picture (fullscreen zapping).
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const {
    insets,
    sourcesOpen,
    setSourcesOpen,
    controller,
    state,
    media,
    setScrubbing,
    setControlsShown,
    controlsVisible,
    waiting,
    starting,
    retained,
    primaryLabel,
    primaryAction,
    title,
    osd,
    zap,
    description,
    pausedBody,
    primaryIcon,
    primaryDisabled,
    zapCluster,
    sourceButton,
    favoriteButton,
  } = view;
  return (
    <View
      style={props.mini ? s.miniBar : props.fullscreen ? s.flex : undefined}
      importantForAccessibility={
        props.sheetOpen ? "no-hide-descendants" : "auto"
      }
      accessibilityElementsHidden={props.sheetOpen}
    >
      <View
        testID="video-stage"
        style={[
          s.videoStage,
          props.fullscreen && s.fullscreenVideo,
          props.mini && s.miniVideo,
        ]}
      >
        {props.remoteAllowed && state.attemptId !== null && (
          <NativeAttempt
            key={state.attemptId}
            uri={props.channel.streamUrl}
            attemptId={state.attemptId}
            controller={controller}
            media={media}
          />
        )}
        {/* The whole picture: tap toggles the overlay; in fullscreen a
            vertical swipe also changes channel. */}
        {!props.mini && (
          <View
            testID={
              props.fullscreen ? "fullscreen-gesture-layer" : "video-tap-layer"
            }
            style={StyleSheet.absoluteFill}
            accessible
            accessibilityRole={props.fullscreen ? "adjustable" : "button"}
            accessibilityLabel={
              props.fullscreen
                ? `${title}，上下滑动换台，轻触显示或隐藏播放操作`
                : controlsVisible
                  ? "隐藏播放操作"
                  : "显示播放操作"
            }
            accessibilityActions={[
              {
                name: "activate",
                label: controlsVisible ? "隐藏播放操作" : "显示播放操作",
              },
              ...(props.fullscreen
                ? [
                    { name: "increment", label: "下一台" },
                    { name: "decrement", label: "上一台" },
                  ]
                : []),
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
                props.fullscreen &&
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
          <View
            style={[
              s.osd,
              {
                top: insets.top + 24,
                marginLeft: insets.left,
                marginRight: insets.right,
              },
            ]}
            pointerEvents="none"
            testID="channel-osd"
          >
            <Text style={s.osdText} numberOfLines={1}>
              {osd}
            </Text>
          </View>
        )}
        {!props.mini &&
          state.phase !== "playing" &&
          !(state.phase === "paused" && state.attemptId !== null) && (
            // box-none: swipes on the dimmed area still reach the gesture layer.
            <View
              style={s.videoNotice}
              pointerEvents="box-none"
              accessibilityLiveRegion="polite"
            >
              <View pointerEvents="none" style={s.noticeText}>
                {waiting && <ActivityIndicator color={colors.accent} />}
                <Text style={s.noticeTitle}>{description.title}</Text>
                {!!(state.phase === "paused"
                  ? pausedBody
                  : description.body) && (
                  <Text style={s.noticeBody}>
                    {state.phase === "paused" ? pausedBody : description.body}
                  </Text>
                )}
                {(state.phase === "timeout" || state.phase === "error") &&
                  props.channel.checkStatus === "unreachable" && (
                    <Text style={s.noticeBody}>
                      上次可用性检测时，这个地址也没有响应。
                    </Text>
                  )}
              </View>
              {waiting && <WaitProgress key={state.attemptId ?? "checking"} />}
              {(state.attemptId === null || starting) && zapCluster(false)}
              {state.phase === "cellular" && (
                <Pressable
                  style={s.quietLink}
                  accessibilityRole="button"
                  accessibilityLabel="暂不播放"
                  onPress={() => controller.pause("cellular-declined")}
                >
                  <Text style={s.quietLinkText}>暂不播放</Text>
                </Pressable>
              )}
            </View>
          )}
        {!props.mini &&
          controlsVisible &&
          !props.sheetOpen &&
          (state.phase === "playing" || retained) &&
          zapCluster(true)}
        {props.mini && (
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel={`展开播放器，${title}`}
            onPress={props.onExpand}
          />
        )}
        {!props.fullscreen && !props.mini && controlsVisible && (
          <>
            <View style={s.portraitMedia} pointerEvents="box-none">
              <MediaStatus media={media} onScrubbingChange={setScrubbing} />
            </View>
            <View style={s.portraitTopLeft}>
              <OverlayButton
                label="返回频道"
                icon={<ChevronLeftIcon />}
                quiet
                accessibilityLabel="返回频道"
                onPress={props.onClose}
              />
            </View>
            <View style={s.portraitBottomRight}>
              <OverlayButton
                label="横屏全屏"
                icon={<FullscreenIcon />}
                quiet
                accessibilityLabel="横屏全屏"
                onPress={props.onToggleFullscreen}
              />
            </View>
          </>
        )}
      </View>
      {props.mini && (
        <>
          <Pressable
            style={s.miniText}
            accessibilityRole="button"
            accessibilityLabel={`展开播放器，${title}`}
            onPress={props.onExpand}
          >
            <Text style={s.miniTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={theme.muted} numberOfLines={1}>
              {state.phase === "playing"
                ? `${qualityName(props.channel)} · ${props.channel.sourceName}`
                : description.title}
            </Text>
          </Pressable>
          <OverlayButton
            label={primaryIcon}
            accessibilityLabel={primaryLabel}
            solid
            disabled={primaryDisabled}
            onPress={primaryAction}
          />
          <OverlayButton
            label="✕"
            accessibilityLabel="停止播放"
            solid
            onPress={props.onClose}
          />
        </>
      )}
      {!props.fullscreen && !props.mini && (
        <View style={s.portraitInfo} testID="portrait-info">
          {/* Title on its own line: room for longer names and extra text. */}
          <Heading
            title={title}
            subtitle={[
              displayGroups(props.channel.groupName),
              ...channelTitle(props.channel.name).tags,
            ].join(" · ")}
          />
          <View style={s.row}>
            {sourceButton}
            <View style={s.flex} />
            {favoriteButton}
          </View>
          {props.orientationError && (
            <Text accessibilityRole="alert" style={s.warning}>
              设备未能切换屏幕方向，可以继续播放或退出全屏。
            </Text>
          )}
        </View>
      )}
      <FullscreenBars view={view} session={props} />
      {props.fullscreen && sourcesOpen && (
        <View
          testID="fullscreen-sources"
          style={[
            s.fullscreenSources,
            {
              top: insets.top + 82,
              right: insets.right + 24,
              bottom: insets.bottom + 16,
            },
          ]}
        >
          <SourceList
            current={props.channel}
            sources={props.sources}
            onSelect={(source) => {
              setSourcesOpen(false);
              props.onSelectSource(source);
            }}
          />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  fullscreenSources: {
    position: "absolute",
    top: 82,
    right: 24,
    width: 300,
    maxHeight: "65%",
    borderRadius: 16,
    padding: 8,
    backgroundColor: "#0A1214D9",
  },
  fullscreenVideo: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: undefined,
    aspectRatio: undefined,
  },
  miniBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingRight: 6,
    backgroundColor: colors.raised,
  },
  miniText: { flex: 1, minHeight: 64, justifyContent: "center", gap: 2 },
  miniTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
  },
  miniVideo: { width: 100, height: 64, aspectRatio: undefined },
  noticeBody: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  noticeText: { gap: 8 },
  quietLink: { alignSelf: "center", paddingHorizontal: 12, paddingVertical: 6 },
  quietLinkText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textDecorationLine: "underline",
  },
  noticeTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 27,
    fontWeight: "600",
    textAlign: "center",
  },
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
  portraitBottomRight: { position: "absolute", bottom: 8, right: 8 },
  portraitInfo: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  portraitMedia: { position: "absolute", left: 12, right: 12, bottom: 10 },
  portraitTopLeft: { position: "absolute", top: 8, left: 8 },
  quietText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "500",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
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
  videoStage: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000000",
    overflow: "hidden",
  },
  warning: { color: colors.warn, fontSize: 12, lineHeight: 18 },
});
