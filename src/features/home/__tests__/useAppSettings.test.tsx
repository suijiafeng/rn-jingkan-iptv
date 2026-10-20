import { act, renderHook, waitFor } from "@testing-library/react-native";
import { openRepository } from "../../../data/repository";
import { useAppSettings } from "../useAppSettings";

jest.mock("../../../data/repository", () => ({ openRepository: jest.fn() }));
jest.mock("expo-network", () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getNetworkStateAsync: jest.fn(),
}));

function fakeRepository(saved: Record<string, unknown>, sourceCount: number) {
  return {
    getSetting: jest.fn(async (key: string, fallback: unknown) =>
      key in saved ? saved[key] : fallback,
    ),
    setSetting: jest.fn(async () => undefined),
    listChannels: jest.fn(async () => []),
    listSources: jest.fn(async () =>
      Array.from({ length: sourceCount }, (_unused, index) => ({
        id: `s${index}`,
      })),
    ),
  };
}

const setError = jest.fn(),
  setTab = jest.fn();

async function mount(repo: ReturnType<typeof fakeRepository>) {
  (openRepository as jest.Mock).mockResolvedValue(repo);
  const hook = await renderHook(() => useAppSettings({ setError, setTab }));
  await waitFor(() => expect(hook.result.current.repo).toBe(repo));
  return hook;
}

test("a first run shows the guide and finishing it is remembered", async () => {
  const repo = fakeRepository({}, 0);
  const { result } = await mount(repo);
  expect(result.current.guideVisible).toBe(true);
  await act(async () => result.current.finishGuide());
  expect(result.current.guideVisible).toBe(false);
  expect(repo.setSetting).toHaveBeenCalledWith("guideSeen", true);
  await act(async () => result.current.showGuide());
  expect(result.current.guideVisible).toBe(true);
});

test("the guide stays closed once seen or when sources already exist", async () => {
  const seen = await mount(fakeRepository({ guideSeen: true }, 0));
  expect(seen.result.current.guideVisible).toBe(false);
  await seen.unmount();
  const upgraded = await mount(fakeRepository({}, 2));
  expect(upgraded.result.current.guideVisible).toBe(false);
  await upgraded.unmount();
});

test("background playback and the mini player start on", async () => {
  const { result } = await mount(fakeRepository({}, 0));
  expect(result.current.backgroundPlayback).toBe(true);
  expect(result.current.miniPlayer).toBe(true);
  await act(async () => result.current.resetToDefaults());
  expect(result.current.backgroundPlayback).toBe(true);
});

test("a saved off stays off", async () => {
  const { result } = await mount(
    fakeRepository({ backgroundPlayback: false, miniPlayer: false }, 1),
  );
  expect(result.current.backgroundPlayback).toBe(false);
  expect(result.current.miniPlayer).toBe(false);
});
