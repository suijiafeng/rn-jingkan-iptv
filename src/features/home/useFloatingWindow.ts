import { useEffect, useState } from "react";
import {
  Animated,
  PanResponder,
  useWindowDimensions,
  type GestureResponderEvent,
  type NativeTouchEvent,
} from "react-native";

/** Docked picture width before any resize. */
export const MINI_DEFAULT_WIDTH = 176;
/** Smallest width: below it the picture stops being readable. */
export const MINI_MIN_WIDTH = 144;
/** Margin kept to the screen sides and above the top inset. */
export const MINI_EDGE = 12;
/**
 * Space a page keeps clear at its bottom while the window is docked: the
 * default picture plus its margin, so the last rows can scroll past it.
 */
export const MINI_WINDOW_SPACE =
  Math.round((MINI_DEFAULT_WIDTH * 9) / 16) + 2 * MINI_EDGE;
/** Movement that turns a touch into a drag rather than a tap. */
const DRAG_SLOP = 6;

export type FloatingSide = "left" | "right";

export interface Offset {
  x: number;
  y: number;
}

export interface FloatingGeometry {
  width: number;
  screenWidth: number;
  /** Height from the window's home bottom edge up to the top margin. */
  room: number;
}

/** The window is the 16:9 picture alone. */
export function pictureHeight(width: number) {
  return Math.round((width * 9) / 16);
}

/** Keeps a width readable, on screen, and below the top margin. */
export function clampWidth(
  width: number,
  limits: { screenWidth: number; maxHeight: number },
) {
  const widest = Math.min(
    limits.screenWidth - 2 * MINI_EDGE,
    (limits.maxHeight * 16) / 9,
  );
  return Math.round(Math.max(MINI_MIN_WIDTH, Math.min(width, widest)));
}

/**
 * Width while dragging a resize edge (the top, or the side facing the
 * middle of the screen): pulling inward or upward enlarges.
 */
export function resizedWidth(
  start: number,
  drag: { dx: number; dy: number },
  side: FloatingSide,
) {
  const inward = side === "right" ? -drag.dx : drag.dx;
  const upward = (-drag.dy * 16) / 9;
  return start + (Math.abs(inward) >= Math.abs(upward) ? inward : upward);
}

/** Offset x that rests the window against the left margin. */
function leftX(geometry: FloatingGeometry) {
  return -(geometry.screenWidth - 2 * MINI_EDGE - geometry.width);
}

/**
 * Where a released window rests. Offsets are from the home spot (bottom
 * right): x snaps to the nearer side, y stays between home and the top.
 */
export function settle(offset: Offset, geometry: FloatingGeometry): Offset {
  const left = leftX(geometry);
  const maxUp = geometry.room - pictureHeight(geometry.width);
  return {
    x: offset.x < left / 2 ? left : 0,
    // No room above (a short screen): it stays home.
    y: maxUp > 0 ? Math.min(0, Math.max(-maxUp, offset.y)) : 0,
  };
}

function spread(touches: readonly NativeTouchEvent[]) {
  const [first, second] = touches;
  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
}

/**
 * The gesture's mutable state lives in one object made once per window:
 * the responder reads the latest geometry from it, never React state.
 */
function createFloatingGesture(
  onWidth: (width: number) => void,
  onSide: (side: FloatingSide) => void,
) {
  const offset = new Animated.ValueXY();
  const geometry: FloatingGeometry = {
    width: MINI_DEFAULT_WIDTH,
    screenWidth: 0,
    room: 0,
  };
  let resting: Offset = { x: 0, y: 0 };
  let side: FloatingSide = "right";
  // What the current touch does: move, resize from an edge, or pinch.
  let mode: "move" | "edge" | "pinch" = "move";
  let start = { width: geometry.width, spread: 0 };
  let moved: Offset | null = null;

  /** Grows or shrinks; the left side keeps its left edge in place. */
  const resize = (raw: number) => {
    const width = clampWidth(raw, {
      screenWidth: geometry.screenWidth,
      maxHeight: geometry.room + resting.y,
    });
    moved = {
      x: side === "left" ? resting.x + (width - start.width) : resting.x,
      y: resting.y,
    };
    geometry.width = width;
    offset.setValue(moved);
    onWidth(width);
  };
  const release = () => {
    resting = settle(moved ?? resting, geometry);
    side = resting.x < 0 ? "left" : "right";
    onSide(side);
    mode = "move";
    moved = null;
    Animated.spring(offset, {
      toValue: resting,
      useNativeDriver: false,
    }).start();
  };
  const responder = PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) =>
      gesture.numberActiveTouches >= 2 ||
      Math.abs(gesture.dx) > DRAG_SLOP ||
      Math.abs(gesture.dy) > DRAG_SLOP,
    onPanResponderGrant: () => {
      moved = null;
      start = { width: geometry.width, spread: 0 };
    },
    onPanResponderMove: (event: GestureResponderEvent, gesture) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        if (mode !== "pinch") {
          mode = "pinch";
          start = { width: geometry.width, spread: spread(touches) };
          return;
        }
        resize((start.width * spread(touches)) / start.spread);
        return;
      }
      if (mode === "edge") {
        resize(resizedWidth(start.width, gesture, side));
        return;
      }
      // Lifting one finger of a pinch must not make the window jump.
      if (mode === "pinch") return;
      moved = { x: resting.x + gesture.dx, y: resting.y + gesture.dy };
      offset.setValue(moved);
    },
    onPanResponderRelease: release,
    onPanResponderTerminate: release,
  });
  return {
    /** Screen width and vertical room, updated as they change. */
    measure(screenWidth: number, room: number) {
      geometry.screenWidth = screenWidth;
      geometry.room = room;
    },
    /** A touch landed on a resize edge: this gesture resizes. */
    edge() {
      mode = "edge";
    },
    /** A tap on an edge that never moved: the next touch moves again. */
    edgeEnd() {
      if (!moved) mode = "move";
    },
    transform: offset.getTranslateTransform(),
    panHandlers: responder.panHandlers,
  };
}

/**
 * The docked player as a floating window: one finger drags it and it snaps
 * to the nearer side on release; its top and inner edges or two fingers resize it.
 * Taps still reach the keys inside, since a gesture is only claimed once it
 * moves. Position and size last for the session only; nothing is stored.
 */
export function useFloatingWindow({
  bottomOffset,
  topInset,
}: {
  /** Distance from the screen bottom to the window's home spot. */
  bottomOffset: number;
  topInset: number;
}) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [width, setWidth] = useState(MINI_DEFAULT_WIDTH);
  const [side, setSide] = useState<FloatingSide>("right");
  const [gesture] = useState(() => createFloatingGesture(setWidth, setSide));
  useEffect(() => {
    gesture.measure(
      screenWidth,
      screenHeight - bottomOffset - topInset - MINI_EDGE,
    );
  }, [gesture, screenWidth, screenHeight, bottomOffset, topInset]);
  return {
    width,
    height: pictureHeight(width),
    side,
    onEdgeTouch: gesture.edge,
    onEdgeTouchEnd: gesture.edgeEnd,
    transform: gesture.transform,
    panHandlers: gesture.panHandlers,
  };
}
