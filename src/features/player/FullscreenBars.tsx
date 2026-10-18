import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { styles as theme } from "../../theme";
import { LiveBadge, MediaStatus, OverlayButton } from "./overlayWidgets";
import { ChevronLeftIcon } from "./playerIcons";
import type { SessionProps } from "./ChannelSession";
import type { SessionView } from "./useChannelSession";

/**
 * Fullscreen only. Top bar: back, title, favorite (what is playing). Bottom
 * bar: the timeline for catch-up streams, the live badge, then the source
 * chip and the channel list (ways to play something else). Zapping lives in
 * the centre cluster the session draws for both layouts.
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
    mediaInfo,
    setScrubbing,
    controlsVisible,
    index,
    title,
    description,
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
                s.fullscreenTop,
                {
                  top: insets.top + 16,
                  left: insets.left + 24,
                  right: insets.right + 24,
                },
              ]
            : s.hidden
        }
      >
        <OverlayButton
          label="退出全屏"
          icon={<ChevronLeftIcon />}
          accessibilityLabel="退出全屏"
          quiet
          onPress={props.onToggleFullscreen}
        />
        <View style={s.flex}>
          <Text style={theme.heading} numberOfLines={1}>
            {title}
          </Text>
          <Text style={theme.muted} numberOfLines={1}>
            {[
              index >= 0
                ? `第 ${index + 1} / ${props.channels.length} 台`
                : null,
              description.title,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
        {props.fullscreen && favoriteButton}
      </View>
      {props.fullscreen && controlsVisible && (
        <View
          testID="fullscreen-bottom-controls"
          style={[
            s.fullscreenBottom,
            {
              bottom: insets.bottom + 16,
              left: insets.left + 24,
              right: insets.right + 24,
            },
          ]}
        >
          {mediaInfo.seekable && (
            <MediaStatus media={media} onScrubbingChange={setScrubbing} />
          )}
          <View style={s.row}>
            {!mediaInfo.seekable && mediaInfo.isLive && <LiveBadge />}
            <View style={s.flex} />
            {sourceButton}
            <OverlayButton
              label="☰ 频道列表"
              accessibilityLabel="频道列表"
              onPress={props.onOpenSheet}
            />
          </View>
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  hidden: { display: "none" },
  fullscreenTop: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: "#0A1214D9",
  },
  fullscreenBottom: {
    position: "absolute",
    gap: 8,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: "#0A1214D9",
  },
});
