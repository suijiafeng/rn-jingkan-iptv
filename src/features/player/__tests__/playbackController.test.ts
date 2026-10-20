import {
  adjacentChannelIndex,
  adjacentPlayableIndex,
  backDestination,
  INITIAL_PLAY_TIMEOUT_MS,
  isOffline,
  LIVE_RECONNECT_LIMIT,
  LIVE_RECONNECT_WINDOW_MS,
  PlaybackController,
} from "../playbackController";
import {
  advanceRound,
  classifyPlayerError,
  nextUntriedSource,
  sourcePosition,
} from "../sourceFailover";
import type { Channel } from "../../../domain/types";
const wifi = { type: "WIFI", isConnected: true, isInternetReachable: true };
const mobile = {
  type: "CELLULAR",
  isConnected: true,
  isInternetReachable: true,
};
function setup(
  overrides: Partial<ConstructorParameters<typeof PlaybackController>[0]> = {},
) {
  const onStarted = jest.fn();
  const checkNetwork = jest.fn().mockResolvedValue(wifi);
  const controller = new PlaybackController({
    remoteAllowed: true,
    mobileWarning: true,
    isAppActive: () => true,
    checkNetwork,
    onStarted,
    ...overrides,
  });
  return { controller, onStarted, checkNetwork };
}
afterEach(() => {
  jest.useRealTimers();
});

describe("playback intent and source isolation", () => {
  test("background playback retains an attempt but still stops on cellular and consent withdrawal", async () => {
    let active = true;
    const { controller } = setup({
      backgroundAllowed: true,
      isAppActive: () => active,
    });
    await controller.requestPlay();
    const id = controller.getSnapshot().attemptId!;
    controller.nativeStarted(id);
    active = false;
    controller.appStateChanged("background");
    expect(controller.isCurrentAttempt(id)).toBe(true);
    controller.nativeStopped(id);
    expect(controller.getSnapshot().phase).toBe("paused");
    controller.nativeStarted(id);
    expect(controller.getSnapshot().phase).toBe("playing");
    controller.networkChanged(mobile);
    expect(controller.getSnapshot()).toEqual({
      phase: "cellular",
      attemptId: null,
    });
    await controller.requestPlay(true);
    controller.setPolicy(false, true);
    expect(controller.getSnapshot()).toEqual({
      phase: "blocked",
      attemptId: null,
    });
    controller.dispose();
  });
  test("PiP reservation survives the Activity background transition but is scoped to its attempt", async () => {
    let active = true;
    const { controller } = setup({ isAppActive: () => active });
    await controller.requestPlay();
    const id = controller.getSnapshot().attemptId!;
    controller.nativeStarted(id);
    controller.setPictureInPicture(id, true);
    active = false;
    controller.appStateChanged("background");
    expect(controller.isCurrentAttempt(id)).toBe(true);
    controller.setPictureInPicture(id, false);
    expect(controller.getSnapshot()).toEqual({
      phase: "paused",
      attemptId: null,
      pauseReason: "background",
    });
    controller.setPictureInPicture(id, true);
    expect(controller.canContinueOutsideApp()).toBe(false);
    controller.dispose();
  });
  test("turning background playback off while inactive releases the attempt", async () => {
    const { controller } = setup({
      backgroundAllowed: true,
      isAppActive: () => false,
    });
    await controller.requestPlay();
    controller.setBackgroundAllowed(false);
    expect(controller.getSnapshot().attemptId).toBeNull();
    controller.dispose();
  });
  test("no native attempt or network check without external-source consent", async () => {
    const { controller, checkNetwork } = setup({ remoteAllowed: false });
    await controller.requestPlay();
    expect(checkNetwork).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toEqual({
      phase: "blocked",
      attemptId: null,
    });
  });
  test("metadata ready is not a recent-view event; actual playing/first-frame is once", async () => {
    const { controller, onStarted } = setup();
    await controller.requestPlay();
    const id = controller.getSnapshot().attemptId!;
    controller.nativeStatus(id, "readyToPlay");
    expect(onStarted).not.toHaveBeenCalled();
    controller.nativeStarted(id);
    controller.nativeStarted(id);
    expect(onStarted).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
  test("old attempt cannot overwrite a retry or add history", async () => {
    const { controller, onStarted } = setup();
    await controller.requestPlay();
    const old = controller.getSnapshot().attemptId!;
    await controller.requestPlay();
    const current = controller.getSnapshot().attemptId!;
    expect(current).not.toBe(old);
    controller.nativeStarted(old);
    controller.nativeStatus(old, "error");
    expect(onStarted).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toEqual({
      phase: "connecting",
      attemptId: current,
    });
    controller.nativeStarted(current);
    expect(onStarted).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
  test("late network lookup cannot start after pause or unmount", async () => {
    let resolve!: (value: typeof wifi) => void;
    const { controller } = setup({
      checkNetwork: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const pending = controller.requestPlay();
    controller.pause();
    resolve(wifi);
    await pending;
    expect(controller.getSnapshot().attemptId).toBeNull();
    const second = controller.requestPlay();
    controller.dispose();
    resolve(wifi);
    await second;
    expect(controller.getSnapshot().attemptId).toBeNull();
  });
  test("initial load times out at 30 seconds and ignores a later first frame", async () => {
    jest.useFakeTimers();
    const { controller, onStarted } = setup();
    await controller.requestPlay();
    const id = controller.getSnapshot().attemptId!;
    jest.advanceTimersByTime(INITIAL_PLAY_TIMEOUT_MS - 1);
    expect(controller.getSnapshot().phase).toBe("connecting");
    jest.advanceTimersByTime(1);
    expect(controller.getSnapshot()).toEqual({
      phase: "timeout",
      attemptId: null,
    });
    controller.nativeStarted(id);
    expect(onStarted).not.toHaveBeenCalled();
  });
  test("successful start cancels initial timeout; buffering does not recreate the player", async () => {
    jest.useFakeTimers();
    const { controller } = setup();
    await controller.requestPlay();
    const id = controller.getSnapshot().attemptId!;
    controller.nativeStarted(id);
    controller.nativeStatus(id, "loading");
    jest.advanceTimersByTime(INITIAL_PLAY_TIMEOUT_MS * 2);
    expect(controller.getSnapshot()).toEqual({
      phase: "buffering",
      attemptId: id,
    });
    controller.dispose();
  });
  test("background and system pause do not resume automatically", async () => {
    const { controller } = setup();
    await controller.requestPlay();
    controller.nativeStarted(controller.getSnapshot().attemptId!);
    controller.appStateChanged("background");
    controller.appStateChanged("active");
    expect(controller.getSnapshot()).toEqual({
      phase: "paused",
      attemptId: null,
      pauseReason: "background",
    });
    await controller.requestPlay();
    const next = controller.getSnapshot().attemptId!;
    controller.nativeStarted(next);
    controller.nativeStopped(next);
    expect(controller.getSnapshot()).toEqual({
      phase: "paused",
      attemptId: next,
      pauseReason: "interrupted",
    });
    controller.nativeStarted(next);
    expect(controller.getSnapshot()).toEqual({
      phase: "playing",
      attemptId: next,
    });
    controller.dispose();
  });
  test("revocation cancels a pending lookup and restoring consent does not autoplay", async () => {
    let resolve!: (value: typeof wifi) => void;
    const { controller } = setup({
      checkNetwork: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const pending = controller.requestPlay();
    controller.setPolicy(false, true);
    resolve(wifi);
    await pending;
    expect(controller.getSnapshot().phase).toBe("blocked");
    controller.setPolicy(true, true);
    expect(controller.getSnapshot().phase).toBe("paused");
    expect(controller.getSnapshot().attemptId).toBeNull();
  });
});

describe("stream end", () => {
  test("an end event before playback started is ignored; after start it ends", async () => {
    const controller = new PlaybackController({
      remoteAllowed: true,
      mobileWarning: false,
      checkNetwork: async () => ({ type: "WIFI", isConnected: true }),
      isAppActive: () => true,
      onStarted: () => {},
    });
    await controller.requestPlay();
    const id = controller.getSnapshot().attemptId!;
    // Empty native player emits ENDED before the source is attached.
    controller.nativeEnded(id);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "connecting",
      attemptId: id,
    });
    controller.nativeStarted(id);
    controller.nativeEnded(id);
    expect(controller.getSnapshot().phase).toBe("ended");
    controller.dispose();
  });
});

describe("network safety", () => {
  test("an unvalidated but connected network is not treated as offline", async () => {
    // Android marks networks that block Google's connectivity check as
    // not reachable even though the internet works (common in mainland China).
    const controller = new PlaybackController({
      remoteAllowed: true,
      mobileWarning: true,
      checkNetwork: async () => ({
        type: "WIFI",
        isConnected: true,
        isInternetReachable: false,
      }),
      isAppActive: () => true,
      onStarted: () => {},
    });
    await controller.requestPlay();
    expect(controller.getSnapshot().phase).toBe("connecting");
    controller.dispose();
    expect(isOffline({ type: "NONE", isConnected: false })).toBe(true);
    expect(
      isOffline({
        type: "WIFI",
        isConnected: true,
        isInternetReachable: false,
      }),
    ).toBe(false);
  });

  test("cellular needs explicit continuation before any native source mounts", async () => {
    const { controller, checkNetwork } = setup();
    checkNetwork.mockResolvedValue(mobile);
    await controller.requestPlay();
    expect(controller.getSnapshot()).toEqual({
      phase: "cellular",
      attemptId: null,
    });
    await controller.requestPlay(true);
    expect(controller.getSnapshot().phase).toBe("connecting");
    controller.dispose();
  });
  test("Wi-Fi to cellular removes attempt, decline remains stopped even on network recovery", async () => {
    const { controller } = setup();
    await controller.requestPlay();
    const old = controller.getSnapshot().attemptId!;
    controller.nativeStarted(old);
    controller.networkChanged(mobile);
    expect(controller.getSnapshot()).toEqual({
      phase: "cellular",
      attemptId: null,
    });
    expect(controller.isCurrentAttempt(old)).toBe(false);
    controller.pause("cellular-declined");
    controller.networkChanged(wifi);
    controller.networkChanged(mobile);
    expect(controller.getSnapshot()).toEqual({
      phase: "paused",
      attemptId: null,
      pauseReason: "cellular-declined",
    });
  });
  test("offline transition stops playback and recovery requires a manual retry", async () => {
    const { controller } = setup();
    await controller.requestPlay();
    controller.networkChanged({ type: "NONE", isConnected: false });
    expect(controller.getSnapshot()).toEqual({
      phase: "offline",
      attemptId: null,
    });
    controller.networkChanged(wifi);
    expect(controller.getSnapshot().phase).toBe("offline");
  });
  test("initial offline state never creates a native attempt", async () => {
    const { controller } = setup({
      checkNetwork: async () => ({ type: "NONE", isConnected: false }),
    });
    await controller.requestPlay();
    expect(controller.getSnapshot()).toEqual({
      phase: "offline",
      attemptId: null,
    });
  });
  test("network inspection failure stops, and unknown transport warns conservatively", async () => {
    const failed = setup({
      checkNetwork: async () => {
        throw new Error("private diagnostic");
      },
    }).controller;
    await failed.requestPlay();
    expect(failed.getSnapshot()).toEqual({
      phase: "error",
      attemptId: null,
      failure: "unknown",
    });
    const unknown = setup({
      checkNetwork: async () => ({ type: "UNKNOWN", isConnected: true }),
    }).controller;
    await unknown.requestPlay();
    expect(unknown.getSnapshot().phase).toBe("cellular");
  });
  test("network event supersedes a stale lookup result", async () => {
    let resolve!: (value: typeof wifi) => void;
    const { controller } = setup({
      checkNetwork: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const pending = controller.requestPlay();
    controller.networkChanged(mobile);
    resolve(wifi);
    await pending;
    expect(controller.getSnapshot()).toEqual({
      phase: "cellular",
      attemptId: null,
    });
  });
});

test("previous/next have boundaries and back dismisses sheet before fullscreen", () => {
  expect(adjacentChannelIndex(3, 0, -1)).toBeNull();
  expect(adjacentChannelIndex(3, 2, 1)).toBeNull();
  expect(adjacentChannelIndex(3, -1, 1)).toBeNull();
  expect(adjacentChannelIndex(3, 0, 1)).toBe(1);
  expect(backDestination(true, true)).toBe("sheet");
  expect(backDestination(false, true)).toBe("fullscreen");
  expect(backDestination(false, false)).toBe("close");
});

test("adjacent playable index skips marked channels and never wraps", () => {
  const items = ["a", "dead", "b", "dead2"];
  const dead = (item: string) => item.startsWith("dead");
  expect(adjacentPlayableIndex(items, 0, 1, dead)).toBe(2);
  expect(adjacentPlayableIndex(items, 2, -1, dead)).toBe(0);
  expect(adjacentPlayableIndex(items, 2, 1, dead)).toBeNull();
  expect(adjacentPlayableIndex(items, 0, -1, dead)).toBeNull();
  expect(adjacentPlayableIndex(items, 0, 1)).toBe(1);
  expect(adjacentPlayableIndex(items, -1, 1, dead)).toBeNull();
});

test("a user pause keeps a started attempt, and a later native stop keeps its reason", async () => {
  const controller = new PlaybackController({
    remoteAllowed: true,
    mobileWarning: false,
    checkNetwork: async () => ({ type: "WIFI", isConnected: true }),
    isAppActive: () => true,
    onStarted: () => {},
  });
  await controller.requestPlay();
  const id = controller.getSnapshot().attemptId!;
  expect(controller.userPaused(id)).toBe(false);
  controller.nativeStarted(id);
  expect(controller.userPaused(id)).toBe(true);
  controller.nativeStopped(id);
  expect(controller.getSnapshot()).toEqual({
    phase: "paused",
    attemptId: id,
    pauseReason: "manual",
  });
  controller.nativeStarted(id);
  expect(controller.getSnapshot()).toEqual({ phase: "playing", attemptId: id });
  controller.dispose();
});

describe("source failover", () => {
  const base: Channel = {
    id: "a",
    identityKey: "a",
    sourceId: "source",
    sourceName: "我的节目单",
    active: true,
    lastSeenRevision: 1,
    lastPlayedAt: null,
    checkStatus: null,
    checkedAt: null,
    name: "山野纪实",
    groupName: "纪录片",
    groupKey: "iptv:shanye.cn",
    streamUrl: "https://example.test/a.m3u8",
    logoUrl: null,
    tvgId: null,
    sortIndex: 0,
    favorite: false,
  };
  // Listed out of order on purpose: the round walks compareChannelSources.
  const high: Channel = {
    ...base,
    id: "c",
    streamUrl: "https://example.test/c.m3u8",
    qualityRank: 1080,
    sortIndex: 2,
  };
  const low: Channel = { ...base, qualityRank: 576 };
  const mid: Channel = {
    ...base,
    id: "b",
    streamUrl: "https://example.test/b.m3u8",
    qualityRank: 720,
    sortIndex: 1,
  };
  const sources = [high, low, mid];

  test("a native error carries only a category and defaults to unknown", async () => {
    const { controller } = setup();
    await controller.requestPlay();
    controller.nativeStatus(controller.getSnapshot().attemptId!, "error");
    expect(controller.getSnapshot()).toEqual({
      phase: "error",
      attemptId: null,
      failure: "unknown",
    });
    await controller.requestPlay();
    controller.nativeStatus(
      controller.getSnapshot().attemptId!,
      "error",
      "network",
    );
    expect(controller.getSnapshot().failure).toBe("network");
    controller.dispose();
  });
  test("only unmistakable transport and container messages are classified", () => {
    expect(
      classifyPlayerError(
        "A playback exception has occurred: Source error Response code: 404",
      ),
    ).toBe("network");
    expect(classifyPlayerError("Unable to connect to https://x.test/a")).toBe(
      "network",
    );
    expect(
      classifyPlayerError("Source error UnrecognizedInputFormatException"),
    ).toBe("media");
    expect(classifyPlayerError("MediaCodecVideoRenderer error, index=0")).toBe(
      "unknown",
    );
    expect(classifyPlayerError(undefined)).toBe("unknown");
  });
  test("a timeout moves to the next source in quality order", () => {
    // The position names the list as shown, not the quality walk.
    expect(sourcePosition(sources, low)).toEqual({ index: 2, total: 3 });
    const step = advanceRound(null, low, sources, "timeout");
    expect(step.next?.id).toBe("b");
    expect(step.round).toEqual({
      groupKey: "iptv:shanye.cn",
      tried: ["a"],
      autoSelected: "b",
    });
  });
  test("every source is tried once, then the round stays for a manual retry", () => {
    const first = advanceRound(null, low, sources, "timeout");
    const second = advanceRound(first.round, mid, sources, "network");
    expect(second.next?.id).toBe("c");
    const third = advanceRound(second.round, high, sources, "media");
    expect(third.next).toBeNull();
    expect(third.round.tried).toEqual(["a", "b", "c"]);
    // The same failure reported again changes nothing.
    expect(advanceRound(third.round, high, sources, "timeout")).toEqual({
      round: third.round,
      next: null,
    });
  });
  test("an unknown native error never switches sources", () => {
    const step = advanceRound(null, low, sources, "unknown");
    expect(step.next).toBeNull();
    expect(step.round.autoSelected).toBeNull();
    expect(nextUntriedSource(sources, low, ["a"])?.id).toBe("b");
  });
  test("a manually chosen source is the start; the walk wraps around it", () => {
    const step = advanceRound(null, high, sources, "timeout");
    expect(step.next?.id).toBe("a");
    const again = advanceRound(step.round, low, sources, "timeout");
    expect(again.next?.id).toBe("b");
    expect(advanceRound(again.round, mid, sources, "timeout").next).toBeNull();
  });
  test("another channel starts a fresh round; a lone source has no alternative", () => {
    const stale = advanceRound(null, low, sources, "timeout").round;
    const other: Channel = { ...base, id: "z", groupKey: "iptv:other.cn" };
    expect(advanceRound(stale, other, [other], "timeout")).toEqual({
      round: { groupKey: "iptv:other.cn", tried: ["z"], autoSelected: null },
      next: null,
    });
  });
});

test("real playback updates availability but user actions and unknown errors do not", async () => {
  jest.useFakeTimers();
  const result = jest.fn();
  const { controller } = setup({ onAvailability: result });
  await controller.requestPlay();
  const firstId = controller.getSnapshot().attemptId!;
  controller.nativeStarted(firstId);
  controller.nativeStarted(firstId);
  expect(result.mock.calls).toEqual([[true]]);
  controller.pause();
  controller.nativeStatus(firstId, "error", "network");
  expect(result).toHaveBeenCalledTimes(1);
  await controller.requestPlay();
  controller.nativeStatus(
    controller.getSnapshot().attemptId!,
    "error",
    "unknown",
  );
  expect(result).toHaveBeenCalledTimes(1);
  await controller.requestPlay();
  controller.nativeStatus(
    controller.getSnapshot().attemptId!,
    "error",
    "media",
  );
  expect(result.mock.calls).toEqual([[true], [false]]);
  await controller.requestPlay();
  jest.advanceTimersByTime(INITIAL_PLAY_TIMEOUT_MS);
  expect(result.mock.calls).toEqual([[true], [false], [false]]);
  await controller.requestPlay();
  controller.networkChanged({ type: "NONE", isConnected: false });
  expect(result).toHaveBeenCalledTimes(3);
  controller.dispose();
});

test("a source error after playback started reconnects at the live edge without marking the address", async () => {
  jest.useFakeTimers();
  const availability = jest.fn();
  const { controller, checkNetwork } = setup({ onAvailability: availability });
  checkNetwork.mockResolvedValue(mobile);
  await controller.requestPlay(true);
  const first = controller.getSnapshot().attemptId!;
  controller.nativeStarted(first);
  controller.nativeStatus(first, "error", "media");
  // The mobile confirmation given for this stream carries over.
  await jest.advanceTimersByTimeAsync(0);
  const second = controller.getSnapshot();
  expect(second.phase).toBe("connecting");
  expect(second.attemptId).not.toBe(first);
  expect(controller.isCurrentAttempt(first)).toBe(false);
  expect(availability.mock.calls).toEqual([[true]]);
  controller.dispose();
});

test("live reconnects are bounded per window; then the error stands but is not recorded", async () => {
  jest.useFakeTimers();
  const availability = jest.fn();
  const { controller } = setup({ onAvailability: availability });
  await controller.requestPlay();
  const failMidStream = async () => {
    const id = controller.getSnapshot().attemptId!;
    controller.nativeStarted(id);
    controller.nativeStatus(id, "error", "media");
    await jest.advanceTimersByTimeAsync(0);
  };
  for (let round = 0; round < LIVE_RECONNECT_LIMIT; round += 1)
    await failMidStream();
  expect(controller.getSnapshot().phase).toBe("connecting");
  await failMidStream();
  expect(controller.getSnapshot()).toMatchObject({
    phase: "error",
    failure: "media",
  });
  expect(availability).not.toHaveBeenCalledWith(false);

  jest.advanceTimersByTime(LIVE_RECONNECT_WINDOW_MS);
  await controller.requestPlay();
  await failMidStream();
  expect(controller.getSnapshot().phase).toBe("connecting");
  controller.dispose();
});

test("errors before the first frame, and network errors after it, do not reconnect", async () => {
  const { controller } = setup();
  await controller.requestPlay();
  controller.nativeStatus(
    controller.getSnapshot().attemptId!,
    "error",
    "media",
  );
  expect(controller.getSnapshot().phase).toBe("error");
  await controller.requestPlay();
  const id = controller.getSnapshot().attemptId!;
  controller.nativeStarted(id);
  controller.nativeStatus(id, "error", "network");
  expect(controller.getSnapshot()).toMatchObject({
    phase: "error",
    failure: "network",
  });
  controller.dispose();
});

test("a player held paused keeps its pause through later native loading and errors", async () => {
  const { controller, checkNetwork } = setup();
  await controller.requestPlay();
  const id = controller.getSnapshot().attemptId!;
  controller.nativeStarted(id);
  expect(controller.userPaused(id)).toBe(true);
  // Retained: the last frame stays on screen.
  expect(controller.getSnapshot()).toMatchObject({
    phase: "paused",
    attemptId: id,
    pauseReason: "manual",
  });
  controller.nativeStatus(id, "loading");
  expect(controller.getSnapshot().phase).toBe("paused");
  // A live window that moved on must not reconnect and play by itself.
  checkNetwork.mockClear();
  controller.nativeStatus(id, "error", "media");
  expect(controller.getSnapshot()).toMatchObject({
    phase: "paused",
    attemptId: null,
    pauseReason: "manual",
  });
  await Promise.resolve();
  expect(checkNetwork).not.toHaveBeenCalled();
  controller.dispose();
});
