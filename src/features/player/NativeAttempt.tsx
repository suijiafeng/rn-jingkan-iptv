import React, { useEffect, useRef, useState } from "react";
import { AppState, StyleSheet } from "react-native";
import {
  createVideoPlayer,
  VideoView,
  type VideoPlayer,
  type VideoSource,
  isPictureInPictureSupported,
} from "expo-video";
import type { MediaHandle } from "./mediaHandle";
import { PlaybackController } from "./playbackController";
import { classifyPlayerError } from "./sourceFailover";
import { resolveContentType } from "./streamFormat";

interface Props {
  audioOnly?: boolean;
  muted?: boolean;
  backgroundAllowed?: boolean;
  title?: string;
  uri: string;
  attemptId: number;
  controller: PlaybackController;
  /** The app's own overlay drives play/pause/seek through this handle. */
  media?: MediaHandle;
}

/** How long a not-playing report must hold before it counts as a pause. */
const STOP_CONFIRM_MS = 400;

// A target, not a guaranteed reserve: live sources may have no future segments
// beyond the playlist window, so the reachable reserve is often shorter.
// Size takes precedence over duration, particularly for high bitrate TV streams.
// expo-video applies minBufferForPlayback to both first start and resume after
// a stall; 2.5 s avoids the stall/play/stall flapping that 1–2 s causes on
// jittery networks while keeping channel zaps responsive.
const playbackBuffer = (audioOnly: boolean) => ({
  preferredForwardBufferDuration: audioOnly ? 60 : 50,
  minBufferForPlayback: 2.5,
  maxBufferBytes: (audioOnly ? 32 : 64) * 1024 * 1024,
  prioritizeTimeOverSizeThreshold: false,
});

/** Owns exactly one player for one attempt; never replaces a previous channel. */
export function NativeAttempt({
  uri,
  attemptId,
  controller,
  media,
  backgroundAllowed = false,
  title = "静看",
  muted = false,
  audioOnly = false,
}: Props) {
  const [player, setPlayer] = useState<VideoPlayer | null>(null);
  const view = useRef<VideoView>(null);
  const backgroundPolicy = useRef(backgroundAllowed);
  const mutePolicy = useRef(muted);
  const audioPolicy = useRef(audioOnly);
  const pipActive = useRef(false);
  const exitPictureInPicture = useRef<(() => void) | null>(null);
  const pendingPip = useRef<{
    resolve: () => void;
    reject: () => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const alive = useRef(false);
  const currentInstance = useRef<VideoPlayer | null>(null);
  useEffect(() => {
    audioPolicy.current = audioOnly;
    const native = currentInstance.current;
    if (!native) return;
    try {
      native.keepScreenOnWhilePlaying = !audioOnly;
      native.bufferOptions = playbackBuffer(audioOnly);
    } catch {
      controller.nativeStatus(attemptId, "error");
    }
  }, [audioOnly, controller, attemptId]);
  useEffect(() => {
    mutePolicy.current = muted;
    if (!currentInstance.current) return;
    try {
      currentInstance.current.muted = muted;
    } catch {
      controller.nativeStatus(attemptId, "error");
    }
  }, [muted, controller, attemptId]);
  useEffect(() => {
    backgroundPolicy.current = backgroundAllowed;
    if (!currentInstance.current) return;
    try {
      currentInstance.current.staysActiveInBackground =
        backgroundAllowed || pipActive.current || !!pendingPip.current;
      currentInstance.current.showNowPlayingNotification =
        backgroundAllowed || pipActive.current || !!pendingPip.current;
    } catch {
      controller.nativeStatus(attemptId, "error");
    }
  }, [backgroundAllowed, controller, attemptId]);

  useEffect(() => {
    alive.current = true;
    let live = true;
    let instance: VideoPlayer | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    // A not-playing report waits to see whether it was only buffering.
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelStop = () => {
      if (stopTimer !== undefined) clearTimeout(stopTimer);
      stopTimer = undefined;
    };
    let settleExit: (() => void) | undefined;
    const sniff = new AbortController();
    const subscriptions: { remove: () => void }[] = [];
    const current = () => live && controller.isCurrentAttempt(attemptId);
    try {
      // Construct empty: even the source is withheld until the controller allows it.
      instance = createVideoPlayer(null);
      const ownedPlayer = instance;
      currentInstance.current = instance;
      ownedPlayer.audioMixingMode = "doNotMix";
      ownedPlayer.muted = mutePolicy.current;
      ownedPlayer.staysActiveInBackground = backgroundPolicy.current;
      ownedPlayer.showNowPlayingNotification = backgroundPolicy.current;
      ownedPlayer.allowsExternalPlayback = false;
      ownedPlayer.keepScreenOnWhilePlaying = !audioPolicy.current;
      ownedPlayer.bufferOptions = playbackBuffer(audioPolicy.current);
      ownedPlayer.loop = false;
      // One sample per second feeds the overlay timeline (catch-up streams only).
      ownedPlayer.timeUpdateEventInterval = 1;
      settleExit = () => {
        if (exitTimer !== undefined) clearTimeout(exitTimer);
        exitTimer = undefined;
        if (!live) return;
        pipActive.current = false;
        ownedPlayer.staysActiveInBackground = backgroundPolicy.current;
        ownedPlayer.showNowPlayingNotification = backgroundPolicy.current;
        controller.setPictureInPicture(attemptId, false);
      };
      exitPictureInPicture.current = () => {
        if (exitTimer !== undefined) clearTimeout(exitTimer);
        // Android can announce PiP exit before React Native sees onResume.
        // Keep the same attempt during that bounded ordering gap. A genuine
        // dismissal still pauses after one second when background is off.
        if (AppState.currentState === "active") settleExit?.();
        else exitTimer = setTimeout(() => settleExit?.(), 1000);
      };
      media?.attach(ownedPlayer);
      media?.attachPictureInPicture(ownedPlayer, async () => {
        if (!current() || !view.current || !isPictureInPictureSupported())
          throw new Error("Picture in picture unavailable");
        if (pendingPip.current || pipActive.current) return;
        // Reserve before the native call: Android can background the Activity
        // before delivering onPictureInPictureStart to JavaScript.
        controller.setPictureInPicture(attemptId, true);
        ownedPlayer.staysActiveInBackground = true;
        ownedPlayer.showNowPlayingNotification = true;
        let entryTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await new Promise<void>((resolve, reject) => {
            const failed = () => reject(new Error("Picture in picture failed"));
            entryTimer = setTimeout(failed, 5000);
            pendingPip.current = { resolve, reject: failed, timer: entryTimer };
            void view.current!.startPictureInPicture().catch(failed);
          });
        } catch {
          if (current()) {
            ownedPlayer.staysActiveInBackground = backgroundPolicy.current;
            ownedPlayer.showNowPlayingNotification = backgroundPolicy.current;
            controller.setPictureInPicture(attemptId, false);
          }
          throw new Error("Picture in picture failed");
        } finally {
          if (entryTimer !== undefined) clearTimeout(entryTimer);
          pendingPip.current = null;
        }
      });
      subscriptions.push(
        ownedPlayer.addListener("statusChange", ({ status, error }) => {
          if (!current()) return;
          if (status !== "readyToPlay") cancelStop();
          media?.sample(ownedPlayer);
          // Only a coarse category leaves this closure; the message does not.
          controller.nativeStatus(
            attemptId,
            status,
            classifyPlayerError(error?.message),
          );
        }),
        ownedPlayer.addListener("timeUpdate", () => {
          if (current()) media?.sample(ownedPlayer);
        }),
        ownedPlayer.addListener("playingChange", ({ isPlaying }) => {
          if (!current()) return;
          cancelStop();
          if (isPlaying) controller.nativeStarted(attemptId);
          else if (ownedPlayer.status === "readyToPlay")
            // A stall can report not-playing a moment before its loading
            // status; only a pause that holds while ready is an interruption
            // (it would otherwise read as "audio taken by another app").
            stopTimer = setTimeout(() => {
              stopTimer = undefined;
              if (
                current() &&
                !ownedPlayer.playing &&
                ownedPlayer.status === "readyToPlay"
              )
                controller.nativeStopped(attemptId);
            }, STOP_CONFIRM_MS);
        }),
        ownedPlayer.addListener("playToEnd", () => {
          if (current()) controller.nativeEnded(attemptId);
        }),
        AppState.addEventListener("change", (state) => {
          if (state === "active" && exitTimer !== undefined) settleExit?.();
          if (state !== "active" && !controller.canContinueOutsideApp()) {
            // Pause synchronously before React commits the controller's unmount.
            ownedPlayer.pause();
            controller.appStateChanged(state);
          }
        }),
      );
      // This effect owns an external native resource, which must not be created
      // during render. Publish its handle for the VideoView after construction.
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
              metadata: { title },
              ...(contentType === "auto" ? {} : { contentType }),
            };
            return ownedPlayer.replaceAsync(source).then(() => {
              if (current()) ownedPlayer.play();
            });
          })
          .catch((reason: unknown) => {
            // Expo 58 provides only PlayerError.message; do not claim HTTP status,
            // expiry, or authentication from unstructured vendor error strings.
            if (current())
              controller.nativeStatus(
                attemptId,
                "error",
                classifyPlayerError(
                  reason instanceof Error ? reason.message : null,
                ),
              );
          });
      }
    } catch {
      if (current()) controller.nativeStatus(attemptId, "error");
    }
    return () => {
      alive.current = false;
      live = false;
      if (exitTimer !== undefined) clearTimeout(exitTimer);
      cancelStop();
      exitPictureInPicture.current = null;
      if (pendingPip.current) {
        clearTimeout(pendingPip.current.timer);
        pendingPip.current.reject();
        pendingPip.current = null;
      }
      pipActive.current = false;
      controller.setPictureInPicture(attemptId, false);
      sniff.abort();
      currentInstance.current = null;
      subscriptions.forEach((subscription) => subscription.remove());
      if (instance) {
        media?.detach(instance);
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
  }, [uri, attemptId, controller, media, title]);

  if (!player) return null;
  return (
    <VideoView
      ref={view}
      testID="native-video-view"
      player={player}
      style={[StyleSheet.absoluteFill, audioOnly && { opacity: 0 }]}
      contentFit="contain"
      surfaceType="textureView"
      // The app draws one overlay for both modes; native controls would add a
      // second, unsynchronised layer and swallow the zap gestures.
      nativeControls={false}
      fullscreenOptions={{ enable: false }}
      allowsPictureInPicture
      startsPictureInPictureAutomatically={false}
      allowsVideoFrameAnalysis={false}
      onPictureInPictureStart={() => {
        if (
          player !== currentInstance.current ||
          !controller.isCurrentAttempt(attemptId)
        )
          return;
        pipActive.current = true;
        pendingPip.current?.resolve();
        controller.setPictureInPicture(attemptId, true);
      }}
      onPictureInPictureStop={() => {
        if (currentInstance.current && player === currentInstance.current) {
          exitPictureInPicture.current?.();
        }
      }}
      useExoShutter
      onFirstFrameRender={() => {
        if (alive.current && player === currentInstance.current)
          controller.nativeStarted(attemptId);
      }}
    />
  );
}
