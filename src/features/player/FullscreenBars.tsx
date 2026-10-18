import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme";
import { LiveBadge, MediaStatus, OverlayButton } from "./overlayWidgets";
import { ChevronLeftIcon, MenuIcon } from "./playerIcons";
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
                  top: insets.top,
                  left: insets.left,
                  right: insets.right,
                },
              ]
            : s.hidden
        }
      >
        <OverlayButton
          label="退出全屏"
          icon={<ChevronLeftIcon size={20} />}
          accessibilityLabel="退出全屏"
          variant="quiet"
          onPress={props.onToggleFullscreen}
        />
        <View style={s.flex}>
          <Text style={s.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={s.subtitle} numberOfLines={1}>
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
              bottom: insets.bottom,
              left: insets.left,
              right: insets.right,
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

const s = StyleSheet.create({
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
  subtitle: { color: "#FFFFFFB3", fontSize: 11, lineHeight: 16 },
});
