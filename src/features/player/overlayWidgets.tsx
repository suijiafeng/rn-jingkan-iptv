import React, { useEffect, useState, useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { colors } from "../../theme";
import { LIVE_EDGE_MARGIN_S, type MediaHandle } from "./mediaHandle";
import { SLOW_START_SECONDS } from "./playerShared";

/** Dots cycle "", ".", "..", "..." once per DOTS_CYCLE_MS. */
const DOTS_CYCLE_MS = 1200;
const DOTS_FRAMES = ["", ".", "..", "..."];

/**
 * A waiting state's title with trailing dots that step, in place of a
 * spinner. Under "reduce motion" the dots stand still as an ellipsis. The
 * dots sit in their own fixed-width run so the title never shifts.
 */
export function LoadingTitle({
  title,
  style,
}: {
  title: string;
  style?: StyleProp<TextStyle>;
}) {
  const [frame, setFrame] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (live) setReduceMotion(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (reduceMotion) return;
    const timer = setTimeout(
      () => setFrame((current) => (current + 1) % DOTS_FRAMES.length),
      DOTS_CYCLE_MS / DOTS_FRAMES.length,
    );
    return () => clearTimeout(timer);
  }, [frame, reduceMotion]);
  return (
    <View style={styles.loadingTitle} pointerEvents="none">
      <Text style={style}>{title}</Text>
      <Text style={[style, styles.loadingDots]} accessibilityElementsHidden>
        {reduceMotion ? "…" : DOTS_FRAMES[frame]}
      </Text>
    </View>
  );
}

/** Visual roles from the prototype: pill (38dp text button over the
 * picture), quiet (40dp icon, no fill until pressed), ring (44dp zap key
 * with a translucent disc and hairline), solid (on an opaque surface). */
export type OverlayVariant = "pill" | "quiet" | "ring" | "solid";

export function OverlayButton({
  label,
  icon,
  accessibilityLabel,
  onPress,
  disabled = false,
  variant = "pill",
  compact = false,
}: {
  label: string;
  /** Drawn in place of the label text; the label still names the button. */
  icon?: React.ReactNode;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: OverlayVariant;
  /** Portrait picture: ring keys shrink from 44dp to 40dp. */
  compact?: boolean;
}) {
  const round = variant === "quiet" || variant === "ring";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={round ? 4 : 6}
      style={({ pressed }) => [
        styles.overlayButton,
        variant === "quiet" && styles.overlayButtonQuiet,
        variant === "ring" && styles.overlayButtonRing,
        variant === "ring" && compact && styles.overlayButtonRingCompact,
        variant === "solid" && styles.overlayButtonSolid,
        pressed && styles.pressed,
        pressed && variant === "quiet" && styles.overlayButtonQuietPressed,
        disabled && styles.overlayButtonDisabled,
      ]}
      onPress={onPress}
    >
      {icon ?? (
        <Text
          style={[
            styles.overlayButtonText,
            variant === "ring" && styles.overlayButtonRingText,
            variant === "ring" &&
              compact &&
              styles.overlayButtonRingTextCompact,
            variant === "quiet" && styles.overlayButtonQuietText,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** Quality in the accent colour, then the source; opens the alternatives. */
export function SourceChip({
  quality,
  sourceName,
  count,
  solid = false,
  disabled = false,
  accessibilityLabel,
  onPress,
}: {
  quality: string;
  sourceName: string;
  count: number;
  /** On the portrait info block (opaque surface) rather than over video. */
  solid?: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.chip,
        solid && styles.chipSolid,
        pressed && styles.pressed,
        disabled && styles.chipDisabled,
      ]}
      onPress={onPress}
    >
      <Text style={styles.chipText} numberOfLines={1}>
        <Text style={styles.chipQuality}>{quality}</Text>
        {` ${sourceName}`}
        {count > 1 ? ` · ${count} 个 ▾` : ""}
      </Text>
    </Pressable>
  );
}

/**
 * The prototype's gradient shade behind the overlay bars, built from stacked
 * translucent strips (no gradient module in the dependency set).
 */
const SHADE_STEPS = 8;
export function Shade({
  edge,
  heightRatio,
}: {
  edge: "top" | "bottom";
  /** Share of the picture the shade covers (0.46 top, 0.52 bottom). */
  heightRatio: number;
}) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.shade,
        edge === "top" ? styles.shadeTop : styles.shadeBottom,
        { height: `${Math.round(heightRatio * 100)}%` },
      ]}
    >
      {Array.from({ length: SHADE_STEPS }, (_unused, step) => {
        // Strip nearest the edge is darkest; alpha fades toward the centre.
        const alpha = 0.74 * (1 - step / SHADE_STEPS);
        return (
          <View
            key={step}
            style={[
              styles.shadeStrip,
              { backgroundColor: `rgba(4, 8, 10, ${alpha.toFixed(3)})` },
            ]}
          />
        );
      })}
    </View>
  );
}

export function LiveBadge({ catchup = false }: { catchup?: boolean }) {
  return (
    <View
      style={styles.liveBadge}
      accessible
      accessibilityLabel={catchup ? "正在看直播" : "直播，不可回看"}
    >
      <View style={styles.liveDot} />
      <Text style={styles.liveText}>直播</Text>
    </View>
  );
}

export function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${sec}`
    : `${minutes}:${sec}`;
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
  // Live at the edge says nothing; behind it, how far. On demand: position.
  const label = info.isLive
    ? behindLive
      ? `落后 ${clock(behind)}`
      : ""
    : `${clock(shown)} / ${clock(duration)}`;
  const at = (offsetX: number) =>
    width > 0 ? Math.min(Math.max(offsetX / width, 0), 1) * duration : shown;
  const scrub = (value: number | null) => {
    setPreview(value);
    onScrubbingChange(value !== null);
  };
  return (
    <View style={styles.timelineRow} testID="media-timeline">
      {!!label && <Text style={styles.timelineText}>{label}</Text>}
      <View
        style={styles.timelineTrack}
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
        <View style={styles.timelineBar} pointerEvents="none">
          <View
            style={[styles.timelineFill, { width: `${fraction * 100}%` }]}
          />
        </View>
        <View
          pointerEvents="none"
          style={[styles.timelineThumb, { left: `${fraction * 100}%` }]}
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
  // One number: "已等 12 秒（最多 30 秒）", then "已等 16 秒 · 比平时慢".
  if (seconds <= 0) return null;
  const line = slow
    ? `已等 ${seconds} 秒 · 比平时慢`
    : `已等 ${seconds} 秒（最多 30 秒）`;
  return (
    <Text style={styles.noticeBody} numberOfLines={1}>
      {line}
    </Text>
  );
}

const styles = StyleSheet.create({
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    minHeight: 32,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#FF6B5E",
  },
  liveText: {
    color: colors.text,
    letterSpacing: 0.7,
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
  loadingTitle: { flexDirection: "row", justifyContent: "center" },
  loadingDots: { width: 22, textAlign: "left" },
  overlayButton: {
    height: 38,
    minWidth: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF24",
    flexShrink: 1,
  },
  overlayButtonQuiet: {
    width: 40,
    height: 40,
    minWidth: 40,
    paddingHorizontal: 0,
    backgroundColor: "transparent",
  },
  overlayButtonQuietPressed: { backgroundColor: "#FFFFFF38" },
  overlayButtonQuietText: { fontSize: 18, lineHeight: 22 },
  overlayButtonRing: {
    width: 44,
    height: 44,
    minWidth: 44,
    paddingHorizontal: 0,
    backgroundColor: "#00000059",
    borderWidth: 1,
    borderColor: "#FFFFFF33",
  },
  overlayButtonRingCompact: { width: 40, height: 40, minWidth: 40 },
  overlayButtonRingText: { fontSize: 20, lineHeight: 24 },
  overlayButtonRingTextCompact: { fontSize: 18, lineHeight: 22 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#FFFFFF1F",
    flexShrink: 1,
  },
  chipSolid: { backgroundColor: colors.raised },
  chipDisabled: { opacity: 0.7 },
  chipText: { color: colors.text, fontSize: 12, lineHeight: 18 },
  chipQuality: { color: colors.accent, fontWeight: "600" },
  shade: { position: "absolute", left: 0, right: 0 },
  shadeTop: { top: 0, flexDirection: "column" },
  shadeBottom: { bottom: 0, flexDirection: "column-reverse" },
  shadeStrip: { flex: 1 },
  overlayButtonDisabled: { opacity: 0.4 },
  overlayButtonSolid: { backgroundColor: colors.raised },
  overlayButtonText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
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
    color: "#FFFFFFCC",
    fontSize: 11,
    lineHeight: 16,
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
