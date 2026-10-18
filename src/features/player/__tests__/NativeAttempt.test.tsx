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
jest.mock("expo-video", () => ({
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
    const { View } =
      jest.requireActual<typeof import("react-native")>("react-native");
    return <View {...props} />;
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
  mockReplace = () => Promise.resolve();
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    writable: true,
    value: "active",
  });
});
afterEach(() => {
  createdControllers.splice(0).forEach((controller) => controller.dispose());
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
    contentType: "hls",
  });
  expect(native.audioMixingMode).toBe("doNotMix");
  expect(native.staysActiveInBackground).toBe(false);
  expect(native.play).toHaveBeenCalledTimes(1);
  expect(onStarted).not.toHaveBeenCalled();
  expect(ui.getByTestId("native-video-view").props).toMatchObject({
    nativeControls: false,
    fullscreenOptions: { enable: false },
    allowsPictureInPicture: false,
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
  expect(controller.getSnapshot()).toEqual({ phase: "error", attemptId: null });
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
