import React, { useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors } from "../../theme";
import { qualityName } from "../../domain/channelSources";
import { channelTitle, displayGroups } from "../../domain/channelLabels";
import { NativeAttempt } from "./NativeAttempt";
import { FullscreenBars } from "./FullscreenBars";
import {
  MediaStatus,
  OverlayButton,
  Shade,
  WaitProgress,
} from "./overlayWidgets";
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
  // Title, then one line of description: the state's body plus any hint.
  const noticeLine = [
    state.phase === "paused" ? pausedBody : description.body,
    (state.phase === "timeout" || state.phase === "error") &&
    props.channel.checkStatus === "unreachable"
      ? "上次检测也没有响应"
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
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
        {props.fullscreen && !controlsVisible && state.phase === "playing" && (
          <View
            style={[s.swipeHint, { right: insets.right + 14 }]}
            pointerEvents="none"
          >
            <Text style={s.swipeHintText}>上下滑动换台</Text>
          </View>
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
              style={[s.videoNotice, waiting && s.videoNoticeSoft]}
              pointerEvents="box-none"
              accessibilityLiveRegion="polite"
            >
              <View pointerEvents="none" style={s.noticeText}>
                {waiting && (
                  <ActivityIndicator size="large" color={colors.accent} />
                )}
                {!(state.phase === "paused" && !pausedBody) && (
                  <Text style={s.noticeTitle}>{description.title}</Text>
                )}
                {waiting ? (
                  <WaitProgress
                    key={state.attemptId ?? "checking"}
                    prefix={description.body}
                  />
                ) : (
                  !!noticeLine && (
                    <Text style={s.noticeBody} numberOfLines={1}>
                      {noticeLine}
                    </Text>
                  )
                )}
              </View>
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
        {!props.mini && controlsVisible && !props.sheetOpen && (
          <>
            <Shade edge="top" heightRatio={0.46} />
            <Shade edge="bottom" heightRatio={0.52} />
          </>
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
                icon={<ChevronLeftIcon size={20} />}
                variant="quiet"
                accessibilityLabel="返回频道"
                onPress={props.onClose}
              />
            </View>
            <View style={s.portraitBottomRight}>
              <OverlayButton
                label="横屏全屏"
                icon={<FullscreenIcon size={20} />}
                variant="quiet"
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
            <Text style={s.miniSubtitle} numberOfLines={1}>
              {state.phase === "playing"
                ? `${qualityName(props.channel)} · ${props.channel.sourceName}`
                : description.title}
            </Text>
          </Pressable>
          <OverlayButton
            label={primaryIcon}
            accessibilityLabel={primaryLabel}
            variant="quiet"
            disabled={primaryDisabled}
            onPress={primaryAction}
          />
          <OverlayButton
            label="✕"
            accessibilityLabel="停止播放"
            variant="quiet"
            onPress={props.onClose}
          />
        </>
      )}
      {!props.fullscreen && !props.mini && (
        <View style={s.portraitInfo} testID="portrait-info">
          {/* Title on its own line: room for longer names and extra text. */}
          <View>
            <Text style={s.infoTitle} numberOfLines={2}>
              {title}
            </Text>
            <Text style={s.infoSubtitle} numberOfLines={1}>
              {[
                displayGroups(props.channel.groupName),
                ...channelTitle(props.channel.name).tags,
              ].join(" · ")}
            </Text>
          </View>
          <View style={s.infoRow}>
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
  miniSubtitle: { color: colors.muted, fontSize: 11, lineHeight: 16 },
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
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    textAlign: "center",
  },
  swipeHint: {
    position: "absolute",
    top: "50%",
    width: 16,
    height: 0,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.55,
  },
  swipeHintText: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 2,
    width: 120,
    textAlign: "center",
    transform: [{ rotate: "90deg" }],
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
  portraitBottomRight: { position: "absolute", bottom: 6, right: 6 },
  portraitInfo: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
  },
  infoSubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  portraitMedia: { position: "absolute", left: 14, right: 56, bottom: 16 },
  portraitTopLeft: { position: "absolute", top: 6, left: 6 },
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
    backgroundColor: "#060A0CD6",
    padding: 14,
    gap: 10,
    justifyContent: "center",
  },
  videoNoticeSoft: { backgroundColor: "#060A0C8C" },
  videoStage: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000000",
    overflow: "hidden",
  },
  warning: { color: colors.warn, fontSize: 12, lineHeight: 18 },
});
