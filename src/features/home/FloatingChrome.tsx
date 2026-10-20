import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { CloseIcon } from "../player/playerIcons";
import type { FloatingSide } from "./useFloatingWindow";

/** Width of the invisible strips along the edges that resize the window. */
const EDGE_GRAB = 14;

/**
 * The floating window's own controls over its picture. ✕ sits faintly in
 * the top corner against the screen edge (a 40dp touch area). The top edge
 * and the edge facing inward resize the window when dragged; nothing marks
 * them, so the picture stays clear. The two edges against the screen are
 * left alone: they are hard to grab and meet the system's edge gestures.
 */
export function FloatingChrome({
  side,
  onClose,
  onEdgeTouch,
  onEdgeTouchEnd,
}: {
  side: FloatingSide;
  onClose: () => void;
  onEdgeTouch: () => void;
  onEdgeTouchEnd: () => void;
}) {
  const outer = side === "right" ? styles.right : styles.left;
  const inner = side === "right" ? styles.left : styles.right;
  // Dragging only; TalkBack resizes nothing, so the strips are skipped.
  const edge = {
    importantForAccessibility: "no-hide-descendants" as const,
    accessibilityElementsHidden: true,
    onTouchStart: onEdgeTouch,
    onTouchEnd: onEdgeTouchEnd,
    onTouchCancel: onEdgeTouchEnd,
  };
  return (
    <>
      <View testID="floating-resize-top" style={styles.topEdge} {...edge} />
      <View style={[styles.sideEdge, inner]} {...edge} />
      <Pressable
        style={[styles.closeKey, outer]}
        accessibilityRole="button"
        accessibilityLabel="停止播放"
        onPress={onClose}
      >
        {({ pressed }) => (
          <View
            style={[
              styles.closeDisc,
              side === "right" ? styles.discRight : styles.discLeft,
              pressed && styles.closePressed,
            ]}
          >
            <CloseIcon size={12} weight={1.5} color="#F1F5F5B3" />
          </View>
        )}
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  topEdge: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: EDGE_GRAB,
  },
  sideEdge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: EDGE_GRAB,
  },
  left: { left: 0 },
  right: { right: 0 },
  closeKey: { position: "absolute", top: 0, width: 40, height: 40 },
  // Faint and close to the corner: present without covering the picture.
  closeDisc: {
    position: "absolute",
    top: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#0B111566",
    alignItems: "center",
    justifyContent: "center",
  },
  discRight: { right: 5 },
  discLeft: { left: 5 },
  closePressed: { backgroundColor: "#0B1115CC" },
});
