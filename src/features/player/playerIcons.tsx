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

/** Speaker with sound waves, or a crossed speaker while muted. */
export function VolumeIcon({
  muted,
  size = 22,
  color = colors.text,
}: IconProps & { muted: boolean }) {
  return (
    <View pointerEvents="none" style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          left: 0,
          top: size * 0.35,
          width: size * 0.26,
          height: size * 0.3,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.15,
          top: size * 0.15,
          borderTopWidth: size * 0.35,
          borderBottomWidth: size * 0.35,
          borderRightWidth: size * 0.35,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderRightColor: color,
        }}
      />
      {muted
        ? ["45deg", "-45deg"].map((rotate) => (
            <View
              key={rotate}
              style={{
                position: "absolute",
                left: size * 0.59,
                top: size * 0.46,
                width: size * 0.42,
                height: 2,
                backgroundColor: color,
                transform: [{ rotate }],
              }}
            />
          ))
        : [0.22, 0.38].map((radius) => (
            <View
              key={radius}
              style={{
                position: "absolute",
                left: size * (0.5 - radius),
                top: size * (0.5 - radius),
                width: size * radius * 2,
                height: size * radius * 2,
                borderRadius: size,
                borderWidth: 2,
                borderRightColor: color,
                borderTopColor: "transparent",
                borderBottomColor: "transparent",
                borderLeftColor: "transparent",
              }}
            />
          ))}
    </View>
  );
}

export function PictureInPictureIcon({
  size = 22,
  color = colors.text,
}: IconProps) {
  return (
    <View
      pointerEvents="none"
      style={{
        width: size,
        height: size * 0.75,
        borderWidth: 2,
        borderColor: color,
      }}
    >
      <View
        style={{
          position: "absolute",
          right: 1,
          bottom: 1,
          width: size * 0.4,
          height: size * 0.3,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/** Back: a plain "<" chevron (portrait collapse, leaving fullscreen). */
export function ChevronLeftIcon({ size = 22, color = colors.text }: IconProps) {
  const arm = size * 0.42;
  return (
    <View
      style={[styles.box, { width: size, height: size }]}
      pointerEvents="none"
    >
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
    <View
      style={[styles.box, { width: size, height: size }]}
      pointerEvents="none"
    >
      <View
        style={[
          styles.corner,
          edge,
          { top: 1, left: 1, borderTopWidth: 2.5, borderLeftWidth: 2.5 },
        ]}
      />
      <View
        style={[
          styles.corner,
          edge,
          { top: 1, right: 1, borderTopWidth: 2.5, borderRightWidth: 2.5 },
        ]}
      />
      <View
        style={[
          styles.corner,
          edge,
          { bottom: 1, left: 1, borderBottomWidth: 2.5, borderLeftWidth: 2.5 },
        ]}
      />
      <View
        style={[
          styles.corner,
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

/** Close a panel: two crossed bars. */
export function CloseIcon({ size = 20, color = colors.text }: IconProps) {
  const bar = {
    position: "absolute" as const,
    width: size * 0.7,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: color,
  };
  return (
    <View
      style={[styles.box, { width: size, height: size }]}
      pointerEvents="none"
    >
      <View style={[bar, { transform: [{ rotate: "45deg" }] }]} />
      <View style={[bar, { transform: [{ rotate: "-45deg" }] }]} />
    </View>
  );
}

/** Scroll the list to the playing channel: a ring with a centre dot. */
export function LocateIcon({ size = 20, color = colors.text }: IconProps) {
  const ring = size * 0.7;
  return (
    <View
      style={[styles.box, { width: size, height: size }]}
      pointerEvents="none"
    >
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: 2,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.22,
          height: size * 0.22,
          borderRadius: size,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/** Open the channel list: three bars. */
export function MenuIcon({ size = 20, color = colors.text }: IconProps) {
  const bar = {
    width: size * 0.75,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: color,
  };
  return (
    <View
      style={[styles.box, { width: size, height: size, gap: size * 0.18 }]}
      pointerEvents="none"
    >
      <View style={bar} />
      <View style={bar} />
      <View style={bar} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
  corner: { position: "absolute" },
});
