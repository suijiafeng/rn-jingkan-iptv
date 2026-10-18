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
  remoteAllowed: boolean;
  mobileWarning: boolean;
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
   * (foreground only; leaving the app still pauses). The owner switches the
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
  paused: { title: "已暂停", body: "点击播放，继续收看当前频道" },
  checking: { title: "正在检查网络", body: "确认连接后开始播放" },
  connecting: { title: "正在连接频道", body: "首次加载最多等待 30 秒" },
  playing: { title: "正在播放", body: "画面来自你的节目源" },
  buffering: { title: "正在缓冲", body: "等待节目源传送画面" },
  cellular: {
    title: "可能使用移动数据",
    body: "当前网络可能产生流量费用。继续后，连回 Wi-Fi 之前不再询问。",
  },
  blocked: {
    title: "外部连接已关闭",
    body: "返回设置，允许连接自己的节目源后再播放",
  },
  offline: { title: "网络未连接", body: "检查网络连接，然后手动重试" },
  timeout: {
    title: "连接超时",
    body: "30 秒内未开始播放。节目源可能已失效、受地区限制或暂时不可用。可以重试、换台，或在来源管理中检测可用性",
  },
  error: {
    title: "暂时无法播放",
    body: "原因未确定（播放器没有提供可靠的细分原因）。常见情况：地址失效、地区限制、服务器拒绝或格式不支持。可以重试、换台，或在来源管理中检测可用性",
  },
  ended: { title: "节目流已结束", body: "可以重试连接，或选择其他频道" },
};

export const CONTROLS_HIDE_MS = 4000;
/** Channel name/position overlay after a switch in fullscreen. */
export const OSD_MS = 2500;
/** After this long without a picture, suggest moving on (spec: prompt at 15 s). */
export const SLOW_START_SECONDS = 15;
/** Minimum vertical travel (dp) for a fullscreen swipe to change channel. */
export const SWIPE_MIN_DP = 60;
export const TAP_SLOP_DP = 12;
export const sameChannel = (a: Channel, b: Channel) =>
  (a.groupKey ?? a.id) === (b.groupKey ?? b.id);

/** Fullscreen and sheet belong to the screen, not to the replaceable channel. */
