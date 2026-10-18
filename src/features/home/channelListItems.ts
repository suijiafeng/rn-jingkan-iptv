import type { Channel } from "../../domain/types";

// The empty state is a sentinel row so it renders below the header overlay.
export const EMPTY_ROW = { kind: "empty" } as const;
export type ChannelListItem = Channel | typeof EMPTY_ROW;

export const channelListKey = (item: ChannelListItem) =>
  item === EMPTY_ROW ? "__empty__" : (item as Channel).id;
