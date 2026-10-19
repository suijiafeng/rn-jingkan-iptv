import React from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * Bottom navigation glyphs, drawn from plain views like the player icons
 * (see playerIcons.tsx), so no icon font or SVG dependency is needed.
 */
interface NavIconProps {
  color: string;
  /** Selected tabs fill the glyph where that reads better (the star). */
  filled?: boolean;
  size?: number;
}

/** 频道: a screen on a short stand. */
export function TvIcon({ color, size = 22 }: NavIconProps) {
  return (
    <View style={[styles.box, { width: size, height: size }]}>
      <View
        style={{
          width: size * 0.9,
          height: size * 0.62,
          borderRadius: 3,
          borderWidth: 2,
          borderColor: color,
        }}
      />
      <View
        style={{
          width: size * 0.4,
          height: 2,
          marginTop: 2,
          borderRadius: 1,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/** 收藏: the same star the channel rows use. */
export function StarIcon({ color, filled = false, size = 22 }: NavIconProps) {
  return (
    <View style={[styles.box, { width: size, height: size }]}>
      <Text
        allowFontScaling={false}
        style={{ color, fontSize: size, lineHeight: size + 2 }}
      >
        {filled ? "★" : "☆"}
      </Text>
    </View>
  );
}

/** 最近: a clock face with two hands. */
export function ClockIcon({ color, size = 22 }: NavIconProps) {
  const face = size * 0.86;
  const hand = { position: "absolute" as const, backgroundColor: color };
  return (
    <View style={[styles.box, { width: size, height: size }]}>
      <View
        style={{
          width: face,
          height: face,
          borderRadius: face / 2,
          borderWidth: 2,
          borderColor: color,
        }}
      />
      {/* Hour hand straight up from the centre, minute hand to the right. */}
      <View
        style={[
          hand,
          {
            width: 2,
            height: face * 0.3,
            left: size / 2 - 1,
            top: size / 2 - face * 0.3,
          },
        ]}
      />
      <View
        style={[
          hand,
          {
            width: face * 0.26,
            height: 2,
            left: size / 2 - 1,
            top: size / 2 - 1,
          },
        ]}
      />
    </View>
  );
}

/** 设置: three slider tracks with solid knobs at different positions. */
export function SlidersIcon({ color, size = 22 }: NavIconProps) {
  const knob = size * 0.26;
  return (
    <View style={[styles.box, { width: size, height: size, gap: size * 0.1 }]}>
      {[0.2, 0.62, 0.38].map((position) => (
        <View key={position} style={[styles.box, { width: size * 0.9 }]}>
          <View
            style={{
              width: "100%",
              height: 2,
              borderRadius: 1,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              position: "absolute",
              left: size * 0.9 * position - knob / 2,
              width: knob,
              height: knob,
              borderRadius: knob / 2,
              backgroundColor: color,
            }}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
});
