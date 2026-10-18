import React from "react";
import { StyleSheet, View } from "react-native";
import type { Channel } from "../../domain/types";
import { colors } from "../../theme";
import { PlayerScreen } from "../player/PlayerScreen";
import type { ChannelSheetProps } from "../player/playerShared";
import type { AppSettings } from "./useAppSettings";
import type { Playback } from "./usePlayback";

/** Gap between the docked bar and the tab bar under it. */
const MINI_BAR_GAP = 8;

/**
 * The player over the home screen: full screen, or docked as a bar just
 * above the bottom tabs. One tree position for both sizes, so shrinking to
 * the bar and expanding again never remounts the session or its player.
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
}) {
  const { playerMini, previousChannel } = playback;
  // Prefer a fresh row: a refresh may have changed the channel.
  const shownPrevious = previousChannel
    ? (freshRows.find((channel) => channel.id === previousChannel.id) ??
      previousChannel)
    : null;
  return (
    <View
      testID="player-container"
      style={
        playerMini
          ? [playerStyles.miniContainer, { bottom: tabsHeight + MINI_BAR_GAP }]
          : playerStyles.playerOverlay
      }
    >
      <PlayerScreen
        mini={playerMini}
        onMinimize={() => playback.setPlayerMini(true)}
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
        remoteAllowed={settings.remoteAllowed}
        backgroundAllowed={settings.backgroundPlayback}
        mobileWarning={settings.mobileWarning && !settings.mobileAccepted}
        onMobileAccepted={() => settings.setMobileAccepted(true)}
        swipeReverse={settings.swipeReverse}
        skipUnreachable={settings.skipUnreachable}
        previousChannel={shownPrevious}
      />
    </View>
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
  miniContainer: {
    position: "absolute",
    left: 8,
    right: 8,
    borderRadius: 14,
    backgroundColor: colors.raised,
    // Elevation keeps the bar above list rows on Android.
    elevation: 6,
  },
});
