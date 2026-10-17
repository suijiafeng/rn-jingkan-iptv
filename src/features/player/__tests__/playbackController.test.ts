import {
  adjacentChannelIndex,
  backDestination,
  INITIAL_PLAY_TIMEOUT_MS,
  isOffline,
  PlaybackController,
} from "../playbackController";
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
    expect(controller.getSnapshot().pauseReason).toBe("interrupted");
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
    expect(failed.getSnapshot()).toEqual({ phase: "error", attemptId: null });
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
