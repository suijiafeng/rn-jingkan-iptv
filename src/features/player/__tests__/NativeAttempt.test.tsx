import React from "react";
import { AppState } from "react-native";
import { act, render } from "@testing-library/react-native";
import { NativeAttempt } from "../NativeAttempt";
import { MediaHandle } from "../mediaHandle";
import { PlaybackController } from "../playbackController";

type Handler = (payload?: Record<string, unknown>) => void;
const mockPlayers: {
  status: string;
  handlers: Record<string, Handler>;
  removed: jest.Mock[];
  replaceAsync: jest.Mock;
  play: jest.Mock;
  pause: jest.Mock;
  release: jest.Mock;
  audioMixingMode?: string;
  staysActiveInBackground?: boolean;
}[] = [];
let mockReplace: () => Promise<void> = () => Promise.resolve();
const createdControllers: PlaybackController[] = [];
const mockEnterPip = jest.fn<Promise<void>, []>(() => Promise.resolve());
jest.mock("expo-video", () => ({
  isPictureInPictureSupported: () => true,
  createVideoPlayer: jest.fn((source: unknown) => {
    if (source !== null) throw new Error("Players must be constructed empty");
    const handlers: Record<string, Handler> = {};
    const removed: jest.Mock[] = [];
    const player = {
      status: "readyToPlay",
      handlers,
      removed,
      replaceAsync: jest.fn(() => mockReplace()),
      play: jest.fn(),
      pause: jest.fn(),
      release: jest.fn(),
      addListener: jest.fn((event: string, handler: Handler) => {
        handlers[event] = handler;
        const remove = jest.fn();
        removed.push(remove);
        return { remove };
      }),
    };
    mockPlayers.push(player);
    return player;
  }),
  VideoView: (props: Record<string, unknown>) => {
    const React = jest.requireActual<typeof import("react")>("react");
    React.useImperativeHandle(props.ref as React.Ref<unknown>, () => ({
      startPictureInPicture: mockEnterPip,
    }));
    const { View } =
      jest.requireActual<typeof import("react-native")>("react-native");
    const { ref: _ref, ...rest } = props;
    return <View {...rest} />;
  },
}));

const mockResolveContentType = jest.fn();
jest.mock("../streamFormat", () => {
  const actual = jest.requireActual("../streamFormat");
  return {
    ...actual,
    resolveContentType: async (uri: string, signal: AbortSignal) =>
      actual.contentTypeFromPath(uri) ?? mockResolveContentType(uri, signal),
  };
});

async function readyController() {
  const onStarted = jest.fn();
  const controller = new PlaybackController({
    remoteAllowed: true,
    mobileWarning: true,
    checkNetwork: async () => ({ type: "WIFI", isConnected: true }),
    isAppActive: () => AppState.currentState === "active",
    onStarted,
  });
  createdControllers.push(controller);
  await controller.requestPlay();
  return { controller, id: controller.getSnapshot().attemptId!, onStarted };
}
beforeEach(() => {
  mockPlayers.length = 0;
  mockEnterPip.mockReset().mockResolvedValue(undefined);
  mockReplace = () => Promise.resolve();
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    writable: true,
    value: "active",
  });
});
afterEach(() => {
  createdControllers.splice(0).forEach((controller) => controller.dispose());
  jest.useRealTimers();
});

test("background setting configures media controls without replacing the player", async () => {
  const { controller, id } = await readyController();
  const ui = await render(
    <NativeAttempt
      uri="https://example.test/live.m3u8"
      attemptId={id}
      controller={controller}
    />,
  );
  await ui.rerender(
    <NativeAttempt
      uri="https://example.test/live.m3u8"
      attemptId={id}
      controller={controller}
      backgroundAllowed
    />,
  );
  expect(mockPlayers).toHaveLength(1);
  expect(mockPlayers[0].staysActiveInBackground).toBe(true);
  expect(mockPlayers[0]).toHaveProperty("showNowPlayingNotification", true);
  await ui.unmount();
});

test("mute is applied before playback and toggles without reconnecting or changing volume", async () => {
  const { controller, id } = await readyController();
  const ui = await render(
    <NativeAttempt
      uri="https://example.test/live.m3u8"
      attemptId={id}
      controller={controller}
      muted
    />,
  );
  const native = mockPlayers[0] as (typeof mockPlayers)[number] & {
    muted: boolean;
    volume: number;
  };
  native.volume = 0.4;
  expect(native.muted).toBe(true);
  await ui.rerender(
    <NativeAttempt
      uri="https://example.test/live.m3u8"
      attemptId={id}
      controller={controller}
      muted={false}
    />,
  );
  expect(native.muted).toBe(false);
  expect(native.volume).toBe(0.4);
  expect(mockPlayers).toHaveLength(1);
  expect(native.replaceAsync).toHaveBeenCalledTimes(1);
  await ui.unmount();
});

test("PiP reserves playback before backgrounding and confirms the actual native event", async () => {
  jest.useFakeTimers();
  const { controller, id } = await readyController();
  const media = new MediaHandle();
  const ui = await render(
    <NativeAttempt
      uri="https://example.test/live.m3u8"
      attemptId={id}
      controller={controller}
      media={media}
    />,
  );
  const entering = media.startPictureInPicture();
  expect(mockEnterPip).toHaveBeenCalledTimes(1);
  expect(controller.canContinueOutsideApp()).toBe(true);
  expect(mockPlayers[0]).toHaveProperty("showNowPlayingNotification", true);
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    value: "background",
  });
  controller.appStateChanged("background");
  await act(() =>
    ui.getByTestId("native-video-view").props.onPictureInPictureStart(),
  );
  expect(await entering).toBe(true);
  expect(controller.isCurrentAttempt(id)).toBe(true);
  await act(() =>
    ui.getByTestId("native-video-view").props.onPictureInPictureStop(),
  );
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(controller.getSnapshot().attemptId).toBeNull();
  expect(mockPlayers[0]).toHaveProperty("showNowPlayingNotification", false);
  await ui.unmount();
});

test("PiP exit preceding Activity resume does not pause or replace playback", async () => {
  jest.useFakeTimers();
  const { controller, id } = await readyController();
  const media = new MediaHandle();
  const ui = await render(
    <NativeAttempt
      uri="https://example.test/live.m3u8"
      attemptId={id}
      controller={controller}
      media={media}
    />,
  );
  const entering = media.startPictureInPicture();
  await act(() =>
    ui.getByTestId("native-video-view").props.onPictureInPictureStart(),
  );
  expect(await entering).toBe(true);
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    value: "background",
  });
  await act(() =>
    ui.getByTestId("native-video-view").props.onPictureInPictureStop(),
  );
  expect(controller.isCurrentAttempt(id)).toBe(true);
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    value: "active",
  });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(controller.isCurrentAttempt(id)).toBe(true);
  expect(controller.canContinueOutsideApp()).toBe(false);
  expect(mockPlayers).toHaveLength(1);
  await ui.unmount();
});

test("silent PiP denial expires and never leaves background permission enabled", async () => {
  jest.useFakeTimers();
  const schedule = jest.spyOn(global, "setTimeout");
  const cancel = jest.spyOn(global, "clearTimeout");
  const { controller, id } = await readyController();
  const media = new MediaHandle();
  const ui = await render(
    <NativeAttempt
      uri="https://example.test/live.m3u8"
      attemptId={id}
      controller={controller}
      media={media}
    />,
  );
  const entering = media.startPictureInPicture();
  const timerIndex = schedule.mock.calls.findIndex((call) => call[1] === 5000);
  const entryTimer = schedule.mock.results[timerIndex].value;
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(await entering).toBe(false);
  expect(controller.canContinueOutsideApp()).toBe(false);
  expect(mockPlayers[0].staysActiveInBackground).toBe(false);
  expect(mockPlayers[0]).toHaveProperty("showNowPlayingNotification", false);
  await ui.unmount();
  controller.dispose();
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  expect(cancel).toHaveBeenCalledWith(entryTimer);
  schedule.mockRestore();
  cancel.mockRestore();
});

test("constructs empty, leaves controls to the app overlay, and loads one HLS attempt", async () => {
  const { controller, id, onStarted } = await readyController();
  const ui = await render(
    <NativeAttempt
      uri="https://example.test/live.m3u8?token=private"
      attemptId={id}
      controller={controller}
    />,
  );
  expect(mockPlayers).toHaveLength(1);
  const native = mockPlayers[0];
  expect(native.replaceAsync).toHaveBeenCalledWith({
    uri: "https://example.test/live.m3u8?token=private",
    useCaching: false,
    metadata: { title: "静看" },
    contentType: "hls",
  });
  expect(native.audioMixingMode).toBe("doNotMix");
  expect(native.staysActiveInBackground).toBe(false);
  expect(native.play).toHaveBeenCalledTimes(1);
  expect(onStarted).not.toHaveBeenCalled();
  expect(ui.getByTestId("native-video-view").props).toMatchObject({
    nativeControls: false,
    fullscreenOptions: { enable: false },
    allowsPictureInPicture: true,
  });
  await act(() => {
    native.handlers.playingChange({ isPlaying: true });
  });
  expect(onStarted).toHaveBeenCalledTimes(1);
  await act(() => {
    ui.getByTestId("native-video-view").props.onFirstFrameRender();
  });
  expect(onStarted).toHaveBeenCalledTimes(1);
  await ui.unmount();
  expect(native.pause).toHaveBeenCalledTimes(1);
  expect(native.release).toHaveBeenCalledTimes(1);
  expect(native.removed.every((remove) => remove.mock.calls.length === 1)).toBe(
    true,
  );
  controller.dispose();
});

test("the media handle samples only catch-up windows and detaches at teardown", async () => {
  const { controller, id } = await readyController();
  const media = new MediaHandle();
  const ui = await render(
    <NativeAttempt
      uri="https://example.test/live.m3u8"
      attemptId={id}
      controller={controller}
      media={media}
    />,
  );
  const native = mockPlayers[0] as (typeof mockPlayers)[number] & {
    isLive: boolean;
    duration: number;
    currentTime: number;
    timeUpdateEventInterval?: number;
  };
  expect(native.timeUpdateEventInterval).toBe(1);
  Object.assign(native, { isLive: true, duration: 30, currentTime: 25 });
  await act(() => native.handlers.timeUpdate({}));
  expect(media.getInfo()).toEqual({ isLive: true, seekable: false });
  expect(media.getTimeline()).toBeNull();
  Object.assign(native, { duration: 3600, currentTime: 1800 });
  await act(() => native.handlers.timeUpdate({}));
  expect(media.getInfo()).toEqual({ isLive: true, seekable: true });
  expect(media.getTimeline()).toEqual({ position: 1800, duration: 3600 });
  expect(media.goLive()).toBe(true);
  expect(native.currentTime).toBe(3590);
  expect(media.pause()).toBe(true);
  expect(native.pause).toHaveBeenCalledTimes(1);
  await ui.unmount();
  expect(media.getInfo()).toEqual({ isLive: false, seekable: false });
  expect(media.play()).toBe(false);
  controller.dispose();
});

test("late replacement and native callbacks after teardown cannot start or record history", async () => {
  let resolve!: () => void;
  mockReplace = () =>
    new Promise<void>((done) => {
      resolve = done;
    });
  const { controller, id, onStarted } = await readyController();
  const ui = await render(
    <NativeAttempt
      uri="https://example.test/live"
      attemptId={id}
      controller={controller}
    />,
  );
  const native = mockPlayers[0];
  await ui.unmount();
  await act(async () => {
    resolve();
    await Promise.resolve();
    native.handlers.playingChange({ isPlaying: true });
  });
  expect(native.play).not.toHaveBeenCalled();
  expect(onStarted).not.toHaveBeenCalled();
  expect(native.release).toHaveBeenCalledTimes(1);
  controller.dispose();
});

test("background arriving before replacement resolves prevents autoplay", async () => {
  let resolve!: () => void;
  mockReplace = () =>
    new Promise<void>((done) => {
      resolve = done;
    });
  const { controller, id } = await readyController();
  const ui = await render(
    <NativeAttempt
      uri="https://example.test/live"
      attemptId={id}
      controller={controller}
    />,
  );
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    value: "background",
  });
  controller.appStateChanged("background");
  await act(async () => {
    resolve();
    await Promise.resolve();
  });
  expect(mockPlayers[0].play).not.toHaveBeenCalled();
  await ui.unmount();
  controller.dispose();
});

test("unstructured native 401 string remains an unknown error with no credentials exposed", async () => {
  const { controller, id } = await readyController();
  const ui = await render(
    <NativeAttempt
      uri="https://example.test/live?secret=123"
      attemptId={id}
      controller={controller}
    />,
  );
  await act(() => {
    mockPlayers[0].handlers.statusChange({
      status: "error",
      error: { message: "401 https://example.test/live?secret=123" },
    });
  });
  expect(controller.getSnapshot()).toEqual({
    phase: "error",
    attemptId: null,
    failure: "unknown",
  });
  await ui.unmount();
  controller.dispose();
});

test("suffix-less addresses are probed first and loaded with the detected type", async () => {
  mockResolveContentType.mockResolvedValueOnce("hls");
  const { controller, id } = await readyController();
  const ui = await render(
    <NativeAttempt
      uri="https://cdn.example.test/163189/ch8"
      attemptId={id}
      controller={controller}
    />,
  );
  expect(mockResolveContentType).toHaveBeenCalledWith(
    "https://cdn.example.test/163189/ch8",
    expect.anything(),
  );
  expect(mockPlayers[0].replaceAsync).toHaveBeenCalledWith({
    uri: "https://cdn.example.test/163189/ch8",
    useCaching: false,
    metadata: { title: "静看" },
    contentType: "hls",
  });
  await ui.unmount();
  controller.dispose();
});

test("a probe still pending at teardown is aborted and never loads a source", async () => {
  let finish!: (type: string) => void;
  let probeSignal: AbortSignal | undefined;
  mockResolveContentType.mockImplementationOnce(
    (_uri: string, signal: AbortSignal) => {
      probeSignal = signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  const { controller, id } = await readyController();
  const ui = await render(
    <NativeAttempt
      uri="https://cdn.example.test/163189/chu"
      attemptId={id}
      controller={controller}
    />,
  );
  await ui.unmount();
  expect(probeSignal?.aborted).toBe(true);
  await act(async () => finish("hls"));
  expect(mockPlayers[0].replaceAsync).not.toHaveBeenCalled();
  controller.dispose();
});
