import React, { useEffect, useRef, useState } from "react";
import { AppState, StyleSheet } from "react-native";
import {
  createVideoPlayer,
  VideoView,
  type VideoPlayer,
  type VideoSource,
} from "expo-video";
import { PlaybackController } from "./playbackController";
import { resolveContentType } from "./streamFormat";

interface Props {
  uri: string;
  attemptId: number;
  controller: PlaybackController;
}

/** Owns exactly one player for one attempt; never replaces a previous channel. */
export function NativeAttempt({ uri, attemptId, controller }: Props) {
  const [player, setPlayer] = useState<VideoPlayer | null>(null);
  const alive = useRef(false);
  const currentInstance = useRef<VideoPlayer | null>(null);
  useEffect(() => {
    alive.current = true;
    let live = true;
    let instance: VideoPlayer | undefined;
    const sniff = new AbortController();
    const subscriptions: { remove: () => void }[] = [];
    const current = () =>
      live &&
      controller.isCurrentAttempt(attemptId) &&
      AppState.currentState === "active";
    try {
      // Construct empty: even the source is withheld until the controller allows it.
      instance = createVideoPlayer(null);
      const ownedPlayer = instance;
      currentInstance.current = instance;
      ownedPlayer.audioMixingMode = "doNotMix";
      ownedPlayer.staysActiveInBackground = false;
      ownedPlayer.showNowPlayingNotification = false;
      ownedPlayer.allowsExternalPlayback = false;
      ownedPlayer.keepScreenOnWhilePlaying = true;
      ownedPlayer.loop = false;
      subscriptions.push(
        ownedPlayer.addListener("statusChange", ({ status }) => {
          if (current()) controller.nativeStatus(attemptId, status);
        }),
        ownedPlayer.addListener("playingChange", ({ isPlaying }) => {
          if (!current()) return;
          if (isPlaying) controller.nativeStarted(attemptId);
          else if (ownedPlayer.status === "readyToPlay")
            controller.nativeStopped(attemptId);
        }),
        ownedPlayer.addListener("playToEnd", () => {
          if (current()) controller.nativeEnded(attemptId);
        }),
        AppState.addEventListener("change", (state) => {
          if (state !== "active") {
            // Pause synchronously before React commits the controller's unmount.
            ownedPlayer.pause();
            controller.appStateChanged(state);
          }
        }),
      );
      // This effect owns an external native resource, which must not be created
      // during render. Publish its handle for the VideoView after construction.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPlayer(ownedPlayer);
      if (current()) {
        // Suffix-less addresses get one bounded 1 KiB format probe first;
        // without it ExoPlayer would open suffix-less HLS as a plain file.
        void resolveContentType(uri, sniff.signal)
          .then((contentType) => {
            if (!current()) return;
            const source: VideoSource = {
              uri,
              useCaching: false,
              ...(contentType === "auto" ? {} : { contentType }),
            };
            return ownedPlayer.replaceAsync(source).then(() => {
              if (current()) ownedPlayer.play();
            });
          })
          .catch(() => {
            // Expo 58 provides only PlayerError.message; do not claim HTTP status,
            // expiry, or authentication from unstructured vendor error strings.
            if (current()) controller.nativeStatus(attemptId, "error");
          });
      }
    } catch {
      if (current()) controller.nativeStatus(attemptId, "error");
    }
    return () => {
      alive.current = false;
      live = false;
      sniff.abort();
      currentInstance.current = null;
      subscriptions.forEach((subscription) => subscription.remove());
      if (instance) {
        try {
          instance.pause();
        } catch {
          /* Native object may already be gone. */
        }
        try {
          instance.release();
        } catch {
          /* Release is best-effort after native teardown. */
        }
      }
    };
  }, [uri, attemptId, controller]);

  if (!player) return null;
  return (
    <VideoView
      testID="native-video-view"
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      surfaceType="textureView"
      nativeControls={false}
      fullscreenOptions={{ enable: false }}
      allowsPictureInPicture={false}
      startsPictureInPictureAutomatically={false}
      allowsVideoFrameAnalysis={false}
      requiresLinearPlayback
      useExoShutter
      onFirstFrameRender={() => {
        if (alive.current && player === currentInstance.current)
          controller.nativeStarted(attemptId);
      }}
    />
  );
}
