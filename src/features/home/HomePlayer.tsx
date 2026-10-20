import React from "react";
import { Animated, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Channel } from "../../domain/types";
import { colors } from "../../theme";
import { PlayerScreen } from "../player/PlayerScreen";
import type { ChannelSheetProps } from "../player/playerShared";
import type { AppSettings } from "./useAppSettings";
import type { Playback } from "./usePlayback";
import { FloatingChrome } from "./FloatingChrome";
import { MINI_EDGE, useFloatingWindow } from "./useFloatingWindow";

/**
 * The player over the home screen: full screen, or docked as a small
 * floating window just above the bottom tabs. One tree position for both
 * sizes, so docking and expanding again never remounts the session or its
 * player.
 */
export function HomePlayer({
  playing,
  playback,
  settings,
  sheet,
  tabsHeight,
  freshRows,
  error,
  onDismissError,
  onFavorite,
  onStarted,
  onAvailability,
}: {
  playing: Channel;
  playback: Playback;
  settings: AppSettings;
  sheet: ChannelSheetProps;
  tabsHeight: number;
  /** Rows read most recently, preferred over the remembered previous one. */
  freshRows: Channel[];
  error: string;
  onDismissError: () => void;
  onFavorite: (channel: Channel) => void;
  onStarted: (channel: Channel) => void;
  onAvailability: (channel: Channel, ok: boolean) => void;
}) {
  const { playerMini, previousChannel } = playback;
  // The app's safe-area view pads the bottom, and an absolute child is
  // placed from the padding edge: the window must clear that inset too.
  const insets = useSafeAreaInsets();
  const floating = useFloatingWindow({
    bottomOffset: insets.bottom + tabsHeight + MINI_EDGE,
    topInset: insets.top,
  });
  // Prefer a fresh row: a refresh may have changed the channel.
  const shownPrevious = previousChannel
    ? (freshRows.find((channel) => channel.id === previousChannel.id) ??
      previousChannel)
    : null;
  return (
    <Animated.View
      testID="player-container"
      style={
        playerMini
          ? [
              playerStyles.miniContainer,
              {
                bottom: insets.bottom + tabsHeight + MINI_EDGE,
                width: floating.width,
                height: floating.height,
                transform: floating.transform,
              },
            ]
          : playerStyles.playerOverlay
      }
      {...(playerMini ? floating.panHandlers : {})}
    >
      <PlayerScreen
        mini={playerMini}
        // Inside the window's 1dp border.
        miniSize={{ width: floating.width - 2, height: floating.height - 2 }}
        // Without the mini player, leaving the player closes it.
        onMinimize={
          settings.miniPlayer ? () => playback.setPlayerMini(true) : undefined
        }
        onExpand={() => playback.setPlayerMini(false)}
        error={error}
        onDismissError={onDismissError}
        channel={playing}
        channels={playback.playQueue}
        sources={playback.playingSources}
        artworkEnabled={settings.artworkEnabled}
        sheet={sheet}
        onSelect={(channel, queue) => void playback.play(channel, queue)}
        onSelectSource={playback.selectSource}
        onClose={playback.closePlayer}
        onFavorite={onFavorite}
        onStarted={onStarted}
        onAvailability={onAvailability}
        remoteAllowed={settings.remoteAllowed}
        backgroundAllowed={settings.backgroundPlayback}
        onEnableBackgroundPlayback={() =>
          settings.saveToggle("backgroundPlayback", true)
        }
        mobileWarning={settings.mobileWarning && !settings.mobileAccepted}
        onMobileAccepted={() => settings.setMobileAccepted(true)}
        onStopMobileReminders={() =>
          settings.saveToggle("mobileWarning", false)
        }
        swipeReverse={settings.swipeReverse}
        previousChannel={shownPrevious}
      />
      {playerMini && (
        <FloatingChrome
          side={floating.side}
          onClose={playback.closePlayer}
          onEdgeTouch={floating.onEdgeTouch}
          onEdgeTouchEnd={floating.onEdgeTouchEnd}
        />
      )}
    </Animated.View>
  );
}

const playerStyles = StyleSheet.create({
  playerOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.bg,
  },
  // Home spot bottom-right; dragging moves it by a transform from there.
  miniContainer: {
    position: "absolute",
    right: MINI_EDGE,
    borderWidth: 1,
    borderColor: "#FFFFFF1F",
    overflow: "hidden",
    backgroundColor: "#000000",
    // Elevation keeps the window above list rows on Android.
    elevation: 8,
  },
});
