import {
  CHANNEL_ROW_GAP,
  channelRowHeight,
  channelRowLayout,
} from "../ChannelRow";
import { sizes } from "../../theme";

describe("channel row layout", () => {
  it("keeps the standard row height at the default font scale", () => {
    expect(channelRowHeight(1)).toBe(sizes.row);
  });

  it("grows with large fonts so the two text lines still fit", () => {
    expect(channelRowHeight(1.3)).toBeGreaterThan(sizes.row);
    expect(channelRowHeight(2)).toBeGreaterThan(channelRowHeight(1.3));
  });

  it("places rows by arithmetic after any leading space", () => {
    const height = channelRowHeight(1);
    expect(channelRowLayout(height, 0, 100)).toEqual({
      index: 0,
      length: height,
      offset: 100,
    });
    expect(channelRowLayout(height, 250, 100).offset).toBe(
      100 + 250 * (height + CHANNEL_ROW_GAP),
    );
  });
});
