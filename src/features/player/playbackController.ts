import type { AttemptFailure } from "./sourceFailover";

/** A source-free state machine: stream URLs and native errors never enter UI state. */
export type PlaybackPhase =
  | "paused"
  | "checking"
  | "connecting"
  | "playing"
  | "buffering"
  | "cellular"
  | "blocked"
  | "offline"
  | "timeout"
  | "error"
  | "ended";
export type PauseReason =
  "manual" | "background" | "interrupted" | "cellular-declined";
export interface PlaybackSnapshot {
  phase: PlaybackPhase;
  attemptId: number | null;
  pauseReason?: PauseReason;
  /** Only with phase "error": a category, never the native message. */
  failure?: AttemptFailure;
}
export interface ConnectionState {
  type?: string;
  isConnected?: boolean;
  isInternetReachable?: boolean;
}
interface ControllerOptions {
  backgroundAllowed?: boolean;
  remoteAllowed: boolean;
  mobileWarning: boolean;
  checkNetwork: () => Promise<ConnectionState>;
  isAppActive: () => boolean;
  onStarted: () => void;
  onAvailability?: (ok: boolean) => void;
}
export const INITIAL_PLAY_TIMEOUT_MS = 30_000;
/**
 * A live stream that already played and then reports a source error has
 * usually fallen behind its playlist window (BehindLiveWindowException) or
 * met a playlist the server stopped updating. expo-video passes neither class
 * name, so "started, then a media failure" is the signal. A fresh attempt
 * joins at the live edge; this many per window, then the error stands.
 */
export const LIVE_RECONNECT_LIMIT = 3;
export const LIVE_RECONNECT_WINDOW_MS = 120_000;
const activePhases: PlaybackPhase[] = [
  "checking",
  "connecting",
  "playing",
  "buffering",
];
const retainedAttemptPhases: PlaybackPhase[] = [...activePhases, "paused"];
/**
 * Only a missing link counts as offline. isInternetReachable reflects Android's
 * own validation probe (Google connectivitycheck), which fails on networks
 * that block it, e.g. in mainland China, while the internet works; the real
 * request decides there.
 */
export const isOffline = (network: ConnectionState) =>
  network.isConnected === false || network.type === "NONE";
/** VPN/unknown transports cannot establish that playback is on unmetered Wi-Fi. */
export const mightUseMobileData = (network: ConnectionState) =>
  !["WIFI", "ETHERNET", "BLUETOOTH"].includes(network.type ?? "UNKNOWN");

export class PlaybackController {
  private options: ControllerOptions;
  private snapshot: PlaybackSnapshot;
  private listeners = new Set<() => void>();
  private generation = 0;
  private networkVersion = 0;
  private latestNetwork: ConnectionState | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private startedAttempt: number | null = null;
  private disposed = false;
  private pictureInPicture = false;
  private liveReconnects: number[] = [];

  canContinueOutsideApp = () =>
    !!this.options.backgroundAllowed || this.pictureInPicture;

  setBackgroundAllowed(allowed: boolean) {
    this.options = { ...this.options, backgroundAllowed: allowed };
    if (!this.options.isAppActive() && !this.canContinueOutsideApp())
      this.pause("background");
  }

  setPictureInPicture(id: number, enabled: boolean) {
    if (this.disposed || this.snapshot.attemptId !== id) return;
    this.pictureInPicture = enabled;
    if (
      !enabled &&
      !this.options.isAppActive() &&
      !this.options.backgroundAllowed
    )
      this.pause("background");
  }

  constructor(options: ControllerOptions) {
    this.options = options;
    this.snapshot = {
      phase: options.remoteAllowed ? "paused" : "blocked",
      attemptId: null,
    };
  }
  /** React development StrictMode may replay the owning effect. */
  activate() {
    this.disposed = false;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(snapshot: PlaybackSnapshot) {
    if (this.disposed) return;
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
  private clearTimer() {
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.timeout = undefined;
  }
  private stop(phase: PlaybackPhase, pauseReason?: PauseReason) {
    this.pictureInPicture = false;
    ++this.generation;
    this.clearTimer();
    this.publish({
      phase,
      attemptId: null,
      ...(pauseReason ? { pauseReason } : {}),
    });
  }
  /** A stream that already played is reachable: its failure is not recorded. */
  private fail(failure: AttemptFailure, played = false) {
    if (this.snapshot.attemptId !== null && failure !== "unknown" && !played)
      this.options.onAvailability?.(false);
    this.pictureInPicture = false;
    ++this.generation;
    this.clearTimer();
    this.publish({ phase: "error", attemptId: null, failure });
  }
  setOnAvailability(onAvailability: ControllerOptions["onAvailability"]) {
    this.options = { ...this.options, onAvailability };
  }
  setOnStarted(onStarted: () => void) {
    this.options = { ...this.options, onStarted };
  }
  setPolicy(remoteAllowed: boolean, mobileWarning: boolean) {
    const revoked = this.options.remoteAllowed && !remoteAllowed;
    const newlyWarned = !this.options.mobileWarning && mobileWarning;
    this.options = { ...this.options, remoteAllowed, mobileWarning };
    if (!remoteAllowed) {
      if (revoked || this.snapshot.phase !== "blocked") this.stop("blocked");
    } else if (this.snapshot.phase === "blocked") {
      // A settings change never secretly starts a stream.
      this.stop("paused", "manual");
    } else if (
      newlyWarned &&
      this.latestNetwork &&
      mightUseMobileData(this.latestNetwork) &&
      (activePhases.includes(this.snapshot.phase) ||
        this.snapshot.attemptId !== null)
    ) {
      this.stop("cellular");
    }
  }
  async requestPlay(allowMobileForThisAttempt = false): Promise<void> {
    if (this.disposed) return;
    if (!this.options.remoteAllowed) {
      this.stop("blocked");
      return;
    }
    if (!this.options.isAppActive() && !this.canContinueOutsideApp()) {
      this.stop("paused", "background");
      return;
    }
    this.clearTimer();
    const token = ++this.generation;
    const networkVersion = this.networkVersion;
    this.publish({ phase: "checking", attemptId: null });
    let network: ConnectionState;
    try {
      network = await this.options.checkNetwork();
    } catch {
      // Not the stream's fault: no other address is tried for this.
      if (token === this.generation && !this.disposed) this.fail("unknown");
      return;
    }
    if (this.disposed || token !== this.generation) return;
    // A delayed network lookup must never overwrite a newer connectivity event.
    if (networkVersion !== this.networkVersion && this.latestNetwork)
      network = this.latestNetwork;
    this.latestNetwork = network;
    if (!this.options.remoteAllowed) {
      this.stop("blocked");
      return;
    }
    if (!this.options.isAppActive() && !this.canContinueOutsideApp()) {
      this.stop("paused", "background");
      return;
    }
    if (isOffline(network)) {
      this.stop("offline");
      return;
    }
    if (
      this.options.mobileWarning &&
      mightUseMobileData(network) &&
      !allowMobileForThisAttempt
    ) {
      this.stop("cellular");
      return;
    }
    this.startedAttempt = null;
    this.publish({ phase: "connecting", attemptId: token });
    this.timeout = setTimeout(() => {
      if (this.isCurrentAttempt(token) && this.startedAttempt !== token) {
        this.options.onAvailability?.(false);
        this.stop("timeout");
      }
    }, INITIAL_PLAY_TIMEOUT_MS);
  }
  pause(reason: PauseReason = "manual") {
    this.stop(this.options.remoteAllowed ? "paused" : "blocked", reason);
  }
  appStateChanged(state: string) {
    if (state !== "active" && !this.canContinueOutsideApp())
      this.pause("background");
    // Deliberately no automatic resume on foreground.
  }
  networkChanged(network: ConnectionState) {
    if (this.disposed) return;
    const previous = this.latestNetwork;
    this.latestNetwork = network;
    ++this.networkVersion;
    if (
      !activePhases.includes(this.snapshot.phase) &&
      this.snapshot.attemptId === null
    )
      return;
    if (isOffline(network)) {
      this.stop("offline");
      return;
    }
    if (
      this.options.mobileWarning &&
      mightUseMobileData(network) &&
      (!previous || !mightUseMobileData(previous))
    ) {
      // Removing the attempt unmounts/releases its decoder before confirmation.
      this.stop("cellular");
    }
  }
  isCurrentAttempt = (id: number) =>
    !this.disposed &&
    this.options.remoteAllowed &&
    (this.options.isAppActive() || this.canContinueOutsideApp()) &&
    this.snapshot.attemptId === id &&
    retainedAttemptPhases.includes(this.snapshot.phase);
  nativeStarted(id: number) {
    if (!this.isCurrentAttempt(id)) return;
    this.clearTimer();
    this.publish({ phase: "playing", attemptId: id });
    if (this.startedAttempt !== id) {
      this.startedAttempt = id;
      this.options.onAvailability?.(true);
      this.options.onStarted();
    }
  }
  /** Errors default to "unknown", which only a manual retry may follow. */
  nativeStatus(
    id: number,
    status: string,
    failure: Exclude<AttemptFailure, "timeout"> = "unknown",
  ) {
    if (!this.isCurrentAttempt(id)) return;
    // A player held paused (to keep its last frame) may still fail or report
    // loading, e.g. a live window that moved on. Neither may undo the pause:
    // drop the player quietly; the next ▶ reconnects.
    if (this.snapshot.phase === "paused") {
      if (status === "error")
        this.stop("paused", this.snapshot.pauseReason ?? "manual");
      return;
    }
    if (status === "error") {
      const played = this.startedAttempt === id;
      if (played && failure === "media" && this.takeLiveReconnect())
        // The old attempt (and its native player) is dropped by requestPlay;
        // the user already allowed this stream on the current network.
        void this.requestPlay(true);
      else this.fail(failure, played);
    } else if (status === "loading")
      this.publish({
        phase: this.startedAttempt === id ? "buffering" : "connecting",
        attemptId: id,
      });
    // readyToPlay is not evidence that media actually played.
  }
  private takeLiveReconnect(): boolean {
    const now = Date.now();
    this.liveReconnects = this.liveReconnects.filter(
      (at) => now - at < LIVE_RECONNECT_WINDOW_MS,
    );
    if (this.liveReconnects.length >= LIVE_RECONNECT_LIMIT) return false;
    this.liveReconnects.push(now);
    return true;
  }
  nativeStopped(id: number) {
    if (!this.isCurrentAttempt(id)) return;
    // Buffering also emits isPlaying=false. Only a genuine ready-state pause is
    // passed here by the native adapter; never infer audio-focus error strings.
    if (this.startedAttempt === id) {
      // A pause the user already asked for keeps its reason.
      if (this.snapshot.phase === "paused") return;
      this.clearTimer();
      // Retain this attempt so the overlay can resume the same native player
      // without reconnecting the stream.
      this.publish({
        phase: "paused",
        attemptId: id,
        pauseReason: "interrupted",
      });
    }
  }
  /**
   * The overlay paused a started, seekable attempt in place. Returns false when
   * the attempt cannot be retained, so the caller stops it instead.
   */
  userPaused(id: number): boolean {
    if (!this.isCurrentAttempt(id) || this.startedAttempt !== id) return false;
    this.clearTimer();
    this.publish({ phase: "paused", attemptId: id, pauseReason: "manual" });
    return true;
  }
  nativeEnded(id: number) {
    // An empty ExoPlayer (constructed with no source) reports ENDED at once.
    // Only a stream that actually played can end; earlier "ends" are left to
    // the initial timeout or a real error.
    if (this.isCurrentAttempt(id) && this.startedAttempt === id)
      this.stop("ended");
  }
  dispose() {
    this.disposed = true;
    ++this.generation;
    this.clearTimer();
    this.listeners.clear();
  }
}

export function adjacentChannelIndex(
  length: number,
  currentIndex: number,
  direction: -1 | 1,
): number | null {
  const target = currentIndex + direction;
  return currentIndex < 0 || target < 0 || target >= length ? null : target;
}

/**
 * Like adjacentChannelIndex, but steps over channels the caller wants skipped
 * (e.g. last manual check found them unreachable). Boundaries never wrap.
 */
export function adjacentPlayableIndex<T>(
  items: readonly T[],
  currentIndex: number,
  direction: -1 | 1,
  skip: (item: T) => boolean = () => false,
): number | null {
  if (currentIndex < 0) return null;
  for (
    let target = currentIndex + direction;
    target >= 0 && target < items.length;
    target += direction
  )
    if (!skip(items[target])) return target;
  return null;
}

export function backDestination(
  sheetOpen: boolean,
  fullscreen: boolean,
): "sheet" | "fullscreen" | "close" {
  return sheetOpen ? "sheet" : fullscreen ? "fullscreen" : "close";
}
