import {
  clampWidth,
  MINI_MIN_WIDTH,
  pictureHeight,
  resizedWidth,
  settle,
} from "../useFloatingWindow";

describe("floating window geometry", () => {
  const geometry = { width: 176, screenWidth: 412, room: 700 };
  // Resting on the left side: the whole screen minus margins and width.
  const leftX = -(412 - 24 - 176);

  test("a release snaps to the nearer side", () => {
    expect(settle({ x: -40, y: -100 }, geometry)).toEqual({ x: 0, y: -100 });
    expect(settle({ x: leftX + 40, y: -100 }, geometry)).toEqual({
      x: leftX,
      y: -100,
    });
  });

  test("it never rests below home or above the top", () => {
    expect(settle({ x: 0, y: 80 }, geometry).y).toBe(0);
    // Room 700 minus the 99dp picture.
    expect(settle({ x: 0, y: -900 }, geometry).y).toBe(-601);
    // No room above (a short screen): it stays home.
    expect(settle({ x: 0, y: -50 }, { ...geometry, room: 60 }).y).toBe(0);
  });

  test("a resize stays readable, on screen and below the top", () => {
    const limits = { screenWidth: 412, maxHeight: 700 };
    expect(clampWidth(60, limits)).toBe(MINI_MIN_WIDTH);
    expect(clampWidth(900, limits)).toBe(388);
    expect(clampWidth(240, limits)).toBe(240);
    // Little height left above: the width follows the 16:9 limit.
    expect(clampWidth(388, { screenWidth: 412, maxHeight: 180 })).toBe(320);
  });

  test("an edge enlarges when pulled inward or up", () => {
    expect(resizedWidth(176, { dx: -60, dy: 0 }, "right")).toBe(236);
    expect(resizedWidth(176, { dx: 60, dy: 0 }, "left")).toBe(236);
    expect(resizedWidth(176, { dx: 0, dy: -45 }, "right")).toBe(256);
    expect(resizedWidth(176, { dx: 40, dy: 0 }, "right")).toBe(136);
  });

  test("the picture is 16:9", () => {
    expect(pictureHeight(176)).toBe(99);
  });
});
