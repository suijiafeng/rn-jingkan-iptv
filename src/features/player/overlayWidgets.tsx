import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme";
import { LIVE_EDGE_MARGIN_S, type MediaHandle } from "./mediaHandle";
import { SLOW_START_SECONDS } from "./playerShared";

export function OverlayButton({
  label,
  icon,
  accessibilityLabel,
  onPress,
  disabled = false,
  solid = false,
  quiet = false,
  compact = false,
}: {
  /** Drawn in place of the label text; the label still names the button. */
  icon?: React.ReactNode;
  /** No fill until pressed: corner controls that should not compete with the
   * centre cluster for attention. */
  quiet?: boolean;
  /** 40dp instead of 44dp, for the portrait picture's smaller cluster. */
  compact?: boolean;
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  /** On an opaque surface (portrait info block) rather than over the picture. */
  solid?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        s.overlayButton,
        solid && s.overlayButtonSolid,
        quiet && s.overlayButtonQuiet,
        compact && s.overlayButtonCompact,
        pressed && s.pressed,
        pressed && quiet && s.overlayButtonQuietPressed,
        disabled && s.overlayButtonDisabled,
      ]}
      onPress={onPress}
    >
      {icon ?? (
        <Text style={s.overlayButtonText} numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function LiveBadge({ catchup = false }: { catchup?: boolean }) {
  return (
    <View
      style={s.liveBadge}
      accessible
      accessibilityLabel={catchup ? "正在看直播" : "直播，不可回看"}
    >
      <View style={s.liveDot} />
      <Text style={s.liveText}>直播</Text>
    </View>
  );
}

export function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Seeking the stream allows: 30 s per screen-reader step. */
const SEEK_STEP_S = 30;

/**
 * Catch-up or on-demand media gets a timeline; plain live gets a badge only,
 * so the overlay never offers a seek the stream cannot honour.
 */
export function MediaStatus({
  media,
  onScrubbingChange,
}: {
  media: MediaHandle;
  onScrubbingChange: (scrubbing: boolean) => void;
}) {
  const info = useSyncExternalStore(
    media.subscribeInfo,
    media.getInfo,
    media.getInfo,
  );
  const timeline = useSyncExternalStore(
    media.subscribeTimeline,
    media.getTimeline,
    media.getTimeline,
  );
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);
  if (!info.seekable || !timeline) return info.isLive ? <LiveBadge /> : null;
  const { duration } = timeline;
  const shown = preview ?? timeline.position;
  const fraction =
    duration > 0 ? Math.min(Math.max(shown / duration, 0), 1) : 0;
  const behind = duration - shown;
  const behindLive = info.isLive && behind > LIVE_EDGE_MARGIN_S + 5;
  const label = info.isLive
    ? behindLive
      ? `-${clock(behind)}`
      : `可回看 ${clock(duration)}`
    : `${clock(shown)} / ${clock(duration)}`;
  const at = (x: number) =>
    width > 0 ? Math.min(Math.max(x / width, 0), 1) * duration : shown;
  const scrub = (value: number | null) => {
    setPreview(value);
    onScrubbingChange(value !== null);
  };
  return (
    <View style={s.timelineRow} testID="media-timeline">
      <Text style={s.timelineText}>{label}</Text>
      <View
        style={s.timelineTrack}
        onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={info.isLive ? "回看进度" : "播放进度"}
        accessibilityValue={{ text: label }}
        accessibilityActions={[
          { name: "increment", label: `前进 ${SEEK_STEP_S} 秒` },
          { name: "decrement", label: `后退 ${SEEK_STEP_S} 秒` },
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          media.seekTo(
            timeline.position +
              (nativeEvent.actionName === "increment"
                ? SEEK_STEP_S
                : -SEEK_STEP_S),
          );
        }}
        onStartShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={({ nativeEvent }) => scrub(at(nativeEvent.locationX))}
        onResponderMove={({ nativeEvent }) => scrub(at(nativeEvent.locationX))}
        onResponderRelease={({ nativeEvent }) => {
          media.seekTo(at(nativeEvent.locationX));
          scrub(null);
        }}
        onResponderTerminate={() => scrub(null)}
      >
        <View style={s.timelineBar} pointerEvents="none">
          <View style={[s.timelineFill, { width: `${fraction * 100}%` }]} />
        </View>
        <View
          pointerEvents="none"
          style={[s.timelineThumb, { left: `${fraction * 100}%` }]}
        />
      </View>
      {info.isLive &&
        (behindLive ? (
          <OverlayButton label="回到直播" onPress={() => media.goLive()} />
        ) : (
          <LiveBadge catchup />
        ))}
    </View>
  );
}

/**
 * Seconds without a picture, so a dead stream is not a silent 30 s wait.
 * Own component (keyed per attempt) so the 1 s tick re-renders only itself.
 */
export function WaitProgress() {
  const [started] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    // Chained timeouts aligned to whole seconds since start (no setInterval).
    const elapsed = Math.floor((Date.now() - started) / 1000);
    const timer = setTimeout(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      (elapsed + 1) * 1000 - (Date.now() - started),
    );
    return () => clearTimeout(timer);
  }, [started, seconds]);
  const slow = seconds >= SLOW_START_SECONDS;
  return (
    <>
      <View pointerEvents="none" style={s.noticeText}>
        {seconds > 0 && <Text style={s.noticeBody}>已等 {seconds} 秒</Text>}
        {slow && <Text style={s.noticeBody}>比平时慢，可以换台</Text>}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    minHeight: 32,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.bad,
  },
  liveText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  noticeBody: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  noticeText: { gap: 8 },
  overlayButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF1F",
    flexShrink: 1,
  },
  overlayButtonDisabled: { opacity: 0.4 },
  overlayButtonSolid: { backgroundColor: colors.raised },
  overlayButtonQuiet: { backgroundColor: "transparent" },
  overlayButtonQuietPressed: { backgroundColor: "#FFFFFF38" },
  overlayButtonCompact: { minHeight: 40, minWidth: 40, paddingHorizontal: 10 },
  overlayButtonText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "500",
  },
  pressed: { opacity: 0.7 },
  timelineBar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "#FFFFFF40",
    overflow: "hidden",
  },
  timelineFill: { height: 4, backgroundColor: colors.accent },
  timelineRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  timelineText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontVariant: ["tabular-nums"],
    minWidth: 64,
  },
  timelineThumb: {
    position: "absolute",
    top: 10,
    width: 12,
    height: 12,
    marginLeft: -6,
    borderRadius: 6,
    backgroundColor: colors.text,
  },
  timelineTrack: { flex: 1, height: 32, justifyContent: "center" },
});
