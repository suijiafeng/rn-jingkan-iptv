import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme";
import { MediaStatus, OverlayButton } from "./overlayWidgets";
import { ChevronLeftIcon, ExitFullscreenIcon, MenuIcon } from "./playerIcons";
import type { SessionProps } from "./ChannelSession";
import type { SessionView } from "./useChannelSession";

/**
 * Fullscreen only. Top bar: back, title, then the source chip first in the
 * right-hand group (above the popover it opens) and favorite. Bottom bar:
 * the timeline or live badge, then volume first in the right-hand group,
 * audio only, leave landscape and the channel list. Play/pause sits in the
 * middle of the picture; zapping is the vertical swipe.
 */
export function FullscreenBars({
  view,
  session: props,
}: {
  view: SessionView;
  session: SessionProps;
}) {
  const {
    insets,
    media,
    setScrubbing,
    controlsVisible,
    title,
    sourceButton,
    favoriteButton,
  } = view;
  return (
    <>
      <View
        testID="fullscreen-controls"
        style={
          props.fullscreen && controlsVisible
            ? [
                styles.fullscreenTop,
                {
                  top: insets.top,
                  left: insets.left,
                  right: insets.right,
                },
              ]
            : styles.hidden
        }
      >
        <OverlayButton
          label="退出全屏"
          icon={<ChevronLeftIcon size={20} />}
          accessibilityLabel="退出全屏"
          variant="quiet"
          onPress={props.onToggleFullscreen}
        />
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {/* Source leads the right-hand group. */}
        {props.fullscreen && sourceButton}
        {props.fullscreen && favoriteButton}
      </View>
      {props.fullscreen && controlsVisible && (
        <View
          testID="fullscreen-bottom-controls"
          style={[
            styles.fullscreenBottom,
            {
              bottom: insets.bottom,
              left: insets.left,
              right: insets.right,
            },
          ]}
        >
          <View style={styles.row}>
            <View style={styles.flex}>
              <MediaStatus media={media} onScrubbingChange={setScrubbing} />
            </View>
            {/* Volume leads the right-hand group. */}
            {view.muteButton}
            <OverlayButton
              label={props.audioOnly ? "看视频" : "听音频"}
              selected={props.audioOnly}
              onPress={props.onToggleAudioOnly}
            />
            <OverlayButton
              label="退出横屏"
              icon={<ExitFullscreenIcon size={20} />}
              accessibilityLabel="退出横屏"
              variant="quiet"
              onPress={props.onToggleFullscreen}
            />
            <OverlayButton
              label="频道列表"
              icon={<MenuIcon />}
              accessibilityLabel="频道列表"
              variant="quiet"
              onPress={props.onOpenSheet}
            />
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  hidden: { display: "none" },
  // Bars sit on the Shade the session draws; no panel of their own.
  fullscreenTop: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  fullscreenBottom: {
    position: "absolute",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
  },
});
