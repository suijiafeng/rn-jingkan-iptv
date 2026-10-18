import React from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "../../theme";

/**
 * Player glyphs drawn from plain views (borders and corners), so they look
 * the same on every device and need no icon font or SVG dependency.
 */
interface IconProps {
  size?: number;
  color?: string;
}

/** Back: a plain "<" chevron (portrait collapse, leaving fullscreen). */
export function ChevronLeftIcon({ size = 22, color = colors.text }: IconProps) {
  const arm = size * 0.42;
  return (
    <View style={[s.box, { width: size, height: size }]} pointerEvents="none">
      <View
        style={{
          width: arm,
          height: arm,
          marginLeft: arm * 0.45,
          borderLeftWidth: 2.5,
          borderBottomWidth: 2.5,
          borderColor: color,
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  );
}

/** Enter fullscreen: four corner brackets (portrait bottom-right). */
export function FullscreenIcon({ size = 22, color = colors.text }: IconProps) {
  const corner = size * 0.32;
  const edge = { width: corner, height: corner, borderColor: color };
  return (
    <View style={[s.box, { width: size, height: size }]} pointerEvents="none">
      <View
        style={[
          s.corner,
          edge,
          { top: 1, left: 1, borderTopWidth: 2.5, borderLeftWidth: 2.5 },
        ]}
      />
      <View
        style={[
          s.corner,
          edge,
          { top: 1, right: 1, borderTopWidth: 2.5, borderRightWidth: 2.5 },
        ]}
      />
      <View
        style={[
          s.corner,
          edge,
          { bottom: 1, left: 1, borderBottomWidth: 2.5, borderLeftWidth: 2.5 },
        ]}
      />
      <View
        style={[
          s.corner,
          edge,
          {
            bottom: 1,
            right: 1,
            borderBottomWidth: 2.5,
            borderRightWidth: 2.5,
          },
        ]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
  corner: { position: "absolute" },
});
