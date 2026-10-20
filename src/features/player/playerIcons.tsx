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

/** Four corner brackets; inward ones turn each bracket to face the centre. */
function CornerBrackets({
  size,
  color,
  inward,
}: Required<IconProps> & { inward: boolean }) {
  const corner = size * 0.32;
  const edge = { width: corner, height: corner, borderColor: color };
  const corners = [
    { vertical: "top", horizontal: "left" },
    { vertical: "top", horizontal: "right" },
    { vertical: "bottom", horizontal: "left" },
    { vertical: "bottom", horizontal: "right" },
  ] as const;
  const opposite = {
    top: "Bottom",
    bottom: "Top",
    left: "Right",
    right: "Left",
  } as const;
  const capital = {
    top: "Top",
    bottom: "Bottom",
    left: "Left",
    right: "Right",
  } as const;
  return (
    <View
      style={[styles.box, { width: size, height: size }]}
      pointerEvents="none"
    >
      {corners.map(({ vertical, horizontal }) => {
        const borderVertical = inward ? opposite[vertical] : capital[vertical];
        const borderHorizontal = inward
          ? opposite[horizontal]
          : capital[horizontal];
        return (
          <View
            key={`${vertical}-${horizontal}`}
            style={[
              styles.corner,
              edge,
              {
                [vertical]: 1,
                [horizontal]: 1,
                [`border${borderVertical}Width`]: 2.5,
                [`border${borderHorizontal}Width`]: 2.5,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

/** Enter fullscreen: four corner brackets (portrait bottom-right). */
export function FullscreenIcon({ size = 22, color = colors.text }: IconProps) {
  return <CornerBrackets size={size} color={color} inward={false} />;
}

/** Leave fullscreen: the same brackets turned inward (fullscreen bottom bar). */
export function ExitFullscreenIcon({
  size = 22,
  color = colors.text,
}: IconProps) {
  return <CornerBrackets size={size} color={color} inward />;
}

/** Close a panel: two crossed bars; `weight` thins them for small marks. */
export function CloseIcon({
  size = 20,
  color = colors.text,
  weight = 2.5,
}: IconProps & { weight?: number }) {
  const bar = {
    position: "absolute" as const,
    width: size * 0.7,
    height: weight,
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

/** Play: a solid triangle, nudged right so it looks centred. */
export function PlayIcon({ size = 22, color = colors.text }: IconProps) {
  return (
    <View
      style={[styles.box, { width: size, height: size }]}
      pointerEvents="none"
    >
      <View
        style={{
          marginLeft: size * 0.12,
          borderLeftWidth: size * 0.6,
          borderTopWidth: size * 0.35,
          borderBottomWidth: size * 0.35,
          borderLeftColor: color,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
        }}
      />
    </View>
  );
}

/** Pause: two upright bars. */
export function PauseIcon({ size = 22, color = colors.text }: IconProps) {
  const bar = {
    width: size * 0.18,
    height: size * 0.68,
    borderRadius: 1.5,
    backgroundColor: color,
  };
  return (
    <View
      style={[
        styles.box,
        { width: size, height: size, flexDirection: "row", gap: size * 0.18 },
      ]}
      pointerEvents="none"
    >
      <View style={bar} />
      <View style={bar} />
    </View>
  );
}

/**
 * Retry: an open ring (gap at the top right) whose end at twelve o'clock
 * carries a small arrowhead pointing clockwise.
 */
export function RefreshIcon({ size = 16, color = colors.text }: IconProps) {
  const ring = size * 0.78;
  const head = size * 0.2;
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <View
        style={{
          position: "absolute",
          left: (size - ring) / 2,
          top: (size - ring) / 2,
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: 2,
          borderColor: color,
          borderTopColor: "transparent",
          transform: [{ rotate: "45deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size / 2 - head * 0.2,
          top: (size - ring) / 2 - head * 0.6 + 1,
          borderLeftWidth: head,
          borderTopWidth: head * 0.6,
          borderBottomWidth: head * 0.6,
          borderLeftColor: color,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
        }}
      />
    </View>
  );
}

/** Listen only: a headband arc with an ear cup at each end. */
export function HeadphonesIcon({ size = 22, color = colors.text }: IconProps) {
  const band = size * 0.74;
  const cup = { width: size * 0.2, height: size * 0.32, top: size * 0.56 };
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <View
        style={{
          position: "absolute",
          left: (size - band) / 2,
          top: size * 0.14,
          width: band,
          height: band * 0.62,
          borderTopLeftRadius: band / 2,
          borderTopRightRadius: band / 2,
          borderWidth: 2,
          borderBottomWidth: 0,
          borderColor: color,
        }}
      />
      <View
        style={[
          styles.cup,
          cup,
          { left: (size - band) / 2 - 1, backgroundColor: color },
        ]}
      />
      <View
        style={[
          styles.cup,
          cup,
          { right: (size - band) / 2 - 1, backgroundColor: color },
        ]}
      />
    </View>
  );
}

/** Watch the picture again: a screen outline on a short stand. */
export function ScreenIcon({ size = 22, color = colors.text }: IconProps) {
  return (
    <View
      style={[styles.box, { width: size, height: size, gap: size * 0.1 }]}
      pointerEvents="none"
    >
      <View
        style={{
          width: size * 0.84,
          height: size * 0.56,
          borderRadius: 3,
          borderWidth: 2,
          borderColor: color,
        }}
      />
      <View
        style={{
          width: size * 0.36,
          height: 2,
          borderRadius: 1,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
  corner: { position: "absolute" },
  cup: { position: "absolute", borderRadius: 2 },
});
