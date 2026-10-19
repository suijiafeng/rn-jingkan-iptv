import type { Channel } from "../../domain/types";
import type { PlaybackSnapshot } from "./playbackController";
import type { HeaderProps, ListTab } from "../channel/ChannelListParts";

/** The channel page's list and filters, shown in the player's channel sheet. */
export interface ChannelSheetProps {
  /** The page's filter state (tab, search, source, facets); one shared state. */
  filters: HeaderProps;
  onTabChange: (tab: ListTab) => void;
  /** The page's current result in its order (unavailable channels last). */
  channels: Channel[];
  /** Identifies the shown result; null while the next one is loading. */
  rangeKey: string | null;
  loading: boolean;
  /** Show everything (country bypassed) so the playing channel is listed. */
  onLocate: () => void;
}

export interface PlayerScreenProps {
  channel: Channel;
  channels: Channel[];
  /** Alternative stream addresses for the same logical channel. */
  sources: Channel[];
  /** The channel page's list and filters; channels remains the playback queue. */
  sheet: ChannelSheetProps;
  onSelect: (channel: Channel, queue?: Channel[]) => void;
  onSelectSource: (source: Channel) => void;
  onClose: () => void;
  onFavorite: (channel: Channel) => void;
  onStarted: (channel: Channel) => void;
  onAvailability?: (channel: Channel, ok: boolean) => void;
  remoteAllowed: boolean;
  mobileWarning: boolean;
  backgroundAllowed?: boolean;
  onEnableBackgroundPlayback?: () => void;
  /** The user chose to continue on a possibly metered network. */
  onMobileAccepted?: () => void;
  /** Fullscreen swipe up = next channel; true flips it (我的电视 “换台反转”). */
  swipeReverse?: boolean;
  /** Previous/next step over channels the last manual check found unreachable. */
  skipUnreachable?: boolean;
  /** The channel watched just before this one, for a one-tap return. */
  previousChannel?: Channel | null;
  artworkEnabled?: boolean;
  error?: string;
  onDismissError?: () => void;
  /**
   * Docked as a small bar over the channel page while playback continues
   * (background behavior follows the playback setting). The owner switches the
   * container's size; the session, its player and the stream stay mounted.
   */
  mini?: boolean;
  /** Portrait back key: shrink to the bar instead of stopping. */
  onMinimize?: () => void;
  onExpand?: () => void;
}

export const descriptions: Record<
  PlaybackSnapshot["phase"],
  { title: string; body: string }
> = {
  paused: { title: "已暂停", body: "" },
  checking: { title: "正在检查网络", body: "" },
  connecting: { title: "正在连接", body: "" },
  playing: { title: "正在播放", body: "" },
  buffering: { title: "正在缓冲", body: "" },
  cellular: {
    title: "正在用移动数据",
    body: "本次不再提醒，连回 Wi-Fi 后重置",
  },
  blocked: { title: "还没允许联网", body: "去设置里允许后再播放" },
  offline: { title: "没有网络", body: "连上后再试" },
  timeout: { title: "连接超时", body: "" },
  error: { title: "暂时无法播放", body: "原因未知" },
  ended: { title: "直播已结束", body: "" },
};

export const CONTROLS_HIDE_MS = 4000;
/** Channel name/position overlay after a switch in fullscreen. */
export const OSD_MS = 2500;
/** After this long without a picture, suggest moving on (spec: prompt at 15 s). */
export const SLOW_START_SECONDS = 15;
/** Minimum vertical travel (dp) for a fullscreen swipe to change channel. */
export const SWIPE_MIN_DP = 60;
export const TAP_SLOP_DP = 12;
export const sameChannel = (left: Channel, right: Channel) =>
  (left.groupKey ?? left.id) === (right.groupKey ?? right.id);

/** Fullscreen and sheet belong to the screen, not to the replaceable channel. */
