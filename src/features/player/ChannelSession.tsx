import React, { useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { colors } from "../../theme";
import { channelTitle, displayGroups } from "../../domain/channelLabels";
import { NativeAttempt } from "./NativeAttempt";
import { FullscreenBars } from "./FullscreenBars";
import { MediaStatus, OverlayButton, Shade } from "./overlayWidgets";
import { ChevronLeftIcon, FullscreenIcon } from "./playerIcons";
import { SourceList } from "./SourceList";
import {
  SWIPE_MIN_DP,
  TAP_SLOP_DP,
  type PlayerScreenProps,
} from "./playerShared";
import { useChannelSession } from "./useChannelSession";
import type { FailoverView } from "./useSourceFailover";
import { sessionStyles } from "./channelSessionStyles";

export interface SessionProps extends PlayerScreenProps {
  audioOnly: boolean;
  onToggleAudioOnly: () => void;
  onRequestBackgroundPlayback: () => void;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  /** Automatic switching between this channel's addresses after a failure. */
  failover: FailoverView;
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
  // The portrait picture is sized from the window up front, so the page
  // never shifts while the native player is still being created or while
  // nothing is playing; aspectRatio alone would wait for layout.
  const { width: windowWidth } = useWindowDimensions();
  const portraitStageHeight = Math.round((windowWidth * 9) / 16);
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
    title,
    osd,
    zap,
    centerStatus,
    retained,
    sourceButton,
    favoriteButton,
  } = view;
  return (
    <View
      style={
        props.mini
          ? sessionStyles.miniWindow
          : props.fullscreen
            ? sessionStyles.flex
            : undefined
      }
      importantForAccessibility={
        props.sheetOpen ? "no-hide-descendants" : "auto"
      }
      accessibilityElementsHidden={props.sheetOpen}
    >
      <View
        testID="video-stage"
        style={[
          sessionStyles.videoStage,
          !props.fullscreen && !props.mini && { height: portraitStageHeight },
          props.fullscreen && sessionStyles.fullscreenVideo,
          props.mini && props.miniSize,
        ]}
      >
        {props.remoteAllowed && state.attemptId !== null && (
          <NativeAttempt
            key={state.attemptId}
            uri={props.channel.streamUrl}
            attemptId={state.attemptId}
            controller={controller}
            media={media}
            backgroundAllowed={props.backgroundAllowed}
            title={title}
            muted={props.muted}
            audioOnly={props.audioOnly}
          />
        )}
        {/* Shade only the video; every label and control renders above it. */}
        {!props.mini && controlsVisible && !props.sheetOpen && (
          <>
            <Shade edge="top" heightRatio={0.46} />
            <Shade edge="bottom" heightRatio={0.52} />
          </>
        )}
        {props.audioOnly && (
          <View
            style={[
              StyleSheet.absoluteFill,
              sessionStyles.audioStage,
              props.mini && sessionStyles.miniAudioStage,
            ]}
            pointerEvents="none"
            testID="audio-stage"
          >
            <Text style={sessionStyles.audioSymbol}>♫</Text>
            {!props.mini && (
              <Text style={sessionStyles.audioCaption}>正在听音频</Text>
            )}
          </View>
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
                ? `${title}，轻触显示操作`
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
              sessionStyles.osd,
              {
                top: insets.top + 24,
                marginLeft: insets.left,
                marginRight: insets.right,
              },
            ]}
            pointerEvents="none"
            testID="channel-osd"
          >
            <Text style={sessionStyles.osdText} numberOfLines={1}>
              {osd}
            </Text>
          </View>
        )}
        {!props.mini &&
          state.phase !== "playing" &&
          !(state.phase === "paused" && state.attemptId !== null) && (
            // The picture dims and shows only the dots or the one action;
            // the reason is a global toast. box-none: swipes on the dimmed
            // area still reach the gesture layer.
            <View
              style={[
                sessionStyles.videoNotice,
                waiting && sessionStyles.videoNoticeSoft,
              ]}
              pointerEvents="box-none"
            >
              {centerStatus}
            </View>
          )}
        {/* Playing (or paused in place): play/pause in the middle of the
            picture, shown and hidden with the rest of the controls. */}
        {!props.mini &&
          controlsVisible &&
          !props.sheetOpen &&
          (state.phase === "playing" || retained) && (
            <View style={sessionStyles.centerLayer} pointerEvents="box-none">
              {centerStatus}
            </View>
          )}
        {props.mini && view.starting && (
          <View style={sessionStyles.videoNotice} pointerEvents="none">
            <ActivityIndicator color={colors.accent} />
          </View>
        )}
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
            {/* One bottom row: live or catch-up status, then volume and
                fullscreen. Play/pause sits in the middle of the picture. */}
            <View style={sessionStyles.portraitBottom} pointerEvents="box-none">
              <View style={sessionStyles.flex} pointerEvents="box-none">
                <MediaStatus media={media} onScrubbingChange={setScrubbing} />
              </View>
              {view.muteButton}
              {!props.audioOnly && (
                <OverlayButton
                  label="横屏全屏"
                  icon={<FullscreenIcon size={20} />}
                  variant="quiet"
                  accessibilityLabel="横屏全屏"
                  onPress={props.onToggleFullscreen}
                />
              )}
            </View>
            <View style={sessionStyles.portraitTopLeft}>
              {/* Same as the back key: back to the list, playback docks in
                  the bar, whose ✕ is what stops it. */}
              <OverlayButton
                label="返回频道列表"
                icon={<ChevronLeftIcon size={20} />}
                variant="quiet"
                accessibilityLabel={
                  props.onMinimize ? "返回频道列表，继续小窗播放" : "关闭播放器"
                }
                onPress={props.onMinimize ?? props.onClose}
              />
            </View>
            <View style={sessionStyles.portraitTopRight}>
              {!props.audioOnly && view.pictureInPictureButton}
              {/* Listen/watch keeps the corner in both modes. */}
              {view.audioButton}
            </View>
          </>
        )}
      </View>
      {!props.fullscreen && !props.mini && (
        <View style={sessionStyles.portraitInfo} testID="portrait-info">
          {/* Title on its own line: room for longer names and extra text. */}
          <View>
            <Text style={sessionStyles.infoTitle} numberOfLines={2}>
              {title}
            </Text>
            <Text style={sessionStyles.infoSubtitle} numberOfLines={1}>
              {[
                displayGroups(props.channel.groupName),
                ...channelTitle(props.channel.name).tags,
              ].join(" · ")}
            </Text>
          </View>
          <View style={sessionStyles.infoRow}>
            {sourceButton}
            {/* The risk is explained in the confirmation this opens. */}
            {props.audioOnly &&
              !props.backgroundAllowed &&
              props.onEnableBackgroundPlayback && (
                <OverlayButton
                  label="锁屏继续听"
                  onPress={props.onRequestBackgroundPlayback}
                />
              )}
            <View style={sessionStyles.flex} />
            {favoriteButton}
          </View>
          {props.orientationError && (
            <Text accessibilityRole="alert" style={sessionStyles.warning}>
              设备未能切换屏幕方向，可以继续播放或退出全屏。
            </Text>
          )}
        </View>
      )}
      <FullscreenBars view={view} session={props} />
      {props.fullscreen && sourcesOpen && (
        // A tap anywhere outside the list dismisses it, as the portrait sheet does.
        <Pressable
          testID="fullscreen-sources-backdrop"
          style={StyleSheet.absoluteFill}
          accessible={false}
          importantForAccessibility="no"
          onPress={() => setSourcesOpen(false)}
        />
      )}
      {props.fullscreen && sourcesOpen && (
        <View
          testID="fullscreen-sources"
          style={[
            sessionStyles.fullscreenSources,
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
