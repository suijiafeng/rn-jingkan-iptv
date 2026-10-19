import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { showToast } from "../../components/Toast";
import { PlayIcon } from "./playerIcons";
import { colors } from "../../theme";
import type { PlaybackSnapshot } from "./playbackController";
import { descriptions, SLOW_START_SECONDS } from "./playerShared";

const DOT_OFFSETS = [0, 0.14, 0.28];

/** Whether "reduce motion" is on; loops stand still when it is. */
function useReduceMotion() {
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
  return reduceMotion;
}

/**
 * One dot's breath: at rest until its offset in the cycle, then it rises
 * 2dp, swells and brightens, and settles again 0.6 of a cycle later.
 */
const breath = (progress: Animated.Value, offset: number) => {
  const inputRange =
    offset === 0
      ? [0, 0.3, 0.6, 1]
      : [0, offset, offset + 0.3, offset + 0.6, 1];
  const lift = (rest: number, peak: number) =>
    progress.interpolate({
      inputRange,
      outputRange:
        offset === 0
          ? [rest, peak, rest, rest]
          : [rest, rest, peak, rest, rest],
    });
  return {
    opacity: lift(0.35, 1),
    transform: [{ translateY: lift(0, -2) }, { scale: lift(1, 1.25) }],
  };
};

/**
 * Waiting for a picture: three dots in a soft pill, each taking a gentle
 * breath in turn. Past the slow-start mark they turn amber and slow down.
 */
export function LoadingDots({ slow }: { slow: boolean }) {
  const reduceMotion = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduceMotion) return;
    progress.setValue(0);
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: slow ? 1900 : 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, reduceMotion, slow]);
  const color = slow ? colors.warn : colors.accent;
  return (
    <View
      testID="loading-dots"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={slow ? "正在加载，比平时慢" : "正在加载"}
      style={statusStyles.dotsPill}
    >
      {DOT_OFFSETS.map((offset) => (
        <Animated.View
          key={offset}
          style={[
            statusStyles.dot,
            { backgroundColor: color },
            reduceMotion ? statusStyles.dotStill : breath(progress, offset),
          ]}
        />
      ))}
    </View>
  );
}

/** The one action in the middle of the picture: an outlined chip. */
export function CenterChip({
  label,
  icon,
  accessibilityLabel,
  badge,
  disabled = false,
  onPress,
}: {
  label: string;
  icon?: React.ReactNode;
  accessibilityLabel?: string;
  /** A small mark in the corner, read out after the label. */
  badge?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[accessibilityLabel ?? label, badge]
        .filter(Boolean)
        .join("，")}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        statusStyles.chip,
        pressed && statusStyles.pressed,
        disabled && statusStyles.disabled,
      ]}
    >
      {icon}
      <Text style={statusStyles.chipText}>{label}</Text>
      {!!badge && <View testID="chip-badge" style={statusStyles.badge} />}
    </Pressable>
  );
}

/**
 * The mobile-data question in the middle of the picture: what will happen,
 * the one action, and a box to stop asking (it turns off 移动网络提醒).
 */
export function MobileDataPrompt({
  stopReminding,
  onStopRemindingChange,
  disabled,
  onContinue,
}: {
  stopReminding: boolean;
  onStopRemindingChange: (checked: boolean) => void;
  disabled: boolean;
  onContinue: () => void;
}) {
  return (
    <View style={statusStyles.prompt}>
      <Text style={statusStyles.promptText}>播放将消耗流量，是否继续播放</Text>
      <CenterChip
        label="用流量播放"
        icon={<PlayIcon size={13} />}
        disabled={disabled}
        onPress={onContinue}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="不再提醒"
        accessibilityState={{ checked: stopReminding }}
        hitSlop={8}
        onPress={() => onStopRemindingChange(!stopReminding)}
        style={statusStyles.checkRow}
      >
        <View
          style={[statusStyles.checkBox, stopReminding && statusStyles.checked]}
        >
          {stopReminding && <View style={statusStyles.checkMark} />}
        </View>
        <Text style={statusStyles.checkText}>不再提醒</Text>
      </Pressable>
    </View>
  );
}

const NOT_SLOW = Symbol("not slow");

/**
 * True once the current wait (keyed by attempt) has passed the slow-start
 * mark. The timer records which wait went slow, so a new attempt starts
 * fresh without resetting state by hand.
 */
export function useSlowStart(waiting: boolean, attemptKey: unknown) {
  const [slowFor, setSlowFor] = useState<unknown>(NOT_SLOW);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(
      () => setSlowFor(attemptKey),
      SLOW_START_SECONDS * 1000,
    );
    return () => clearTimeout(timer);
  }, [waiting, attemptKey]);
  return waiting && slowFor === attemptKey;
}

/** What the global toast says about a playback state, if anything. */
export function playerNotice({
  phase,
  connectingTitle,
  pausedBody,
  slow,
}: {
  phase: PlaybackSnapshot["phase"];
  connectingTitle: string | null;
  pausedBody: string;
  slow: boolean;
}): string | null {
  // What happened, nothing more: the retry chip is the one action.
  if (
    phase === "timeout" ||
    phase === "error" ||
    phase === "offline" ||
    phase === "ended" ||
    phase === "blocked"
  )
    return descriptions[phase].title;
  if (phase === "paused") return pausedBody || null;
  if (slow) return "网络较慢，正在加载";
  if (phase === "checking" || phase === "connecting") return connectingTitle;
  return null;
}

/** Shows each new notice once, as the app's global toast. */
export function usePlayerNotices(notice: string | null, attemptKey: unknown) {
  useEffect(() => {
    if (notice) showToast(notice);
  }, [notice, attemptKey]);
}

const statusStyles = StyleSheet.create({
  dotsPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    width: 50,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#04080A66",
  },
  dot: { width: 5.5, height: 5.5, borderRadius: 3 },
  dotStill: { opacity: 0.7 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#F1F5F552",
  },
  chipText: { color: colors.text, fontSize: 13, lineHeight: 20 },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.warn,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  prompt: { alignItems: "center", gap: 14, paddingHorizontal: 16 },
  promptText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 32,
  },
  checkBox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#F1F5F5B3",
    alignItems: "center",
    justifyContent: "center",
  },
  checked: { backgroundColor: colors.accent, borderColor: colors.accent },
  // A tick: two borders of a small box, turned 45°.
  checkMark: {
    width: 5,
    height: 9,
    marginTop: -2,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.ink,
    transform: [{ rotate: "45deg" }],
  },
  checkText: { color: "#F1F5F5BF", fontSize: 12, lineHeight: 18 },
});
