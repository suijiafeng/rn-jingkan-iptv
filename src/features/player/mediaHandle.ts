import type { VideoPlayer } from "expo-video";

/**
 * A live window at least this long is treated as catch-up (DVR). Plain live
 * HLS keeps only a few segments (usually well under a minute), where a
 * timeline would promise seeking that the stream cannot honour.
 */
export const CATCHUP_MIN_WINDOW_S = 120;
/** "Back to live" lands this far behind the window end, not on its last frame. */
export const LIVE_EDGE_MARGIN_S = 10;

export interface MediaInfo {
  isLive: boolean;
  /** Only catch-up live windows and finite on-demand media can be scrubbed. */
  seekable: boolean;
}
export interface MediaTimeline {
  /** Seconds since the start of the seekable window (or the file). */
  position: number;
  /** Seekable window (live) or total length (on demand), in seconds. */
  duration: number;
}

export function seekableMedia(isLive: boolean, duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return false;
  return isLive ? duration >= CATCHUP_MIN_WINDOW_S : true;
}

const NO_INFO: MediaInfo = { isLive: false, seekable: false };

/**
 * The UI's narrow handle on the current attempt's native player: play/pause
 * and seeking without reconnecting, plus a sampled timeline. It never exposes
 * the stream address. Info and timeline are separate snapshots so only the
 * timeline view re-renders once per second.
 */
export class MediaHandle {
  private player: VideoPlayer | null = null;
  private info: MediaInfo = NO_INFO;
  private timeline: MediaTimeline | null = null;
  private infoListeners = new Set<() => void>();
  private timelineListeners = new Set<() => void>();

  attach(player: VideoPlayer) {
    this.player = player;
    this.publish(NO_INFO, null);
  }
  /** Only the player that attached may detach (a newer attempt may own it). */
  detach(player: VideoPlayer) {
    if (this.player !== player) return;
    this.player = null;
    this.publish(NO_INFO, null);
  }
  /** Samples the attached player; native reads may throw after release. */
  sample(player: VideoPlayer) {
    if (this.player !== player) return;
    try {
      const duration = player.duration;
      const isLive = player.isLive;
      const seekable = seekableMedia(isLive, duration);
      this.publish(
        { isLive, seekable },
        seekable
          ? {
              duration,
              position: Math.min(Math.max(player.currentTime, 0), duration),
            }
          : null,
      );
    } catch {
      /* The native object may already be gone. */
    }
  }
  private publish(info: MediaInfo, timeline: MediaTimeline | null) {
    if (
      info.isLive !== this.info.isLive ||
      info.seekable !== this.info.seekable
    ) {
      this.info = info;
      this.infoListeners.forEach((listener) => listener());
    }
    if (
      timeline?.position !== this.timeline?.position ||
      timeline?.duration !== this.timeline?.duration
    ) {
      this.timeline = timeline;
      this.timelineListeners.forEach((listener) => listener());
    }
  }

  getInfo = () => this.info;
  getTimeline = () => this.timeline;
  subscribeInfo = (listener: () => void) => {
    this.infoListeners.add(listener);
    return () => {
      this.infoListeners.delete(listener);
    };
  };
  subscribeTimeline = (listener: () => void) => {
    this.timelineListeners.add(listener);
    return () => {
      this.timelineListeners.delete(listener);
    };
  };

  /** False when there is no attached player to act on. */
  play(): boolean {
    return this.act((player) => player.play());
  }
  pause(): boolean {
    return this.act((player) => player.pause());
  }
  seekTo(seconds: number): boolean {
    const timeline = this.timeline;
    if (!timeline) return false;
    const target = Math.min(Math.max(seconds, 0), timeline.duration);
    return this.act((player) => {
      player.currentTime = target;
      this.sample(player);
    });
  }
  /** Approximate live edge: expo-video exposes no seek-to-default-position. */
  goLive(): boolean {
    const timeline = this.timeline;
    if (!timeline || !this.info.isLive) return false;
    return this.seekTo(timeline.duration - LIVE_EDGE_MARGIN_S);
  }
  private act(action: (player: VideoPlayer) => void): boolean {
    const player = this.player;
    if (!player) return false;
    try {
      action(player);
      return true;
    } catch {
      return false;
    }
  }
}
