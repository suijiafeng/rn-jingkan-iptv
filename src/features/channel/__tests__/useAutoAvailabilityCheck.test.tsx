import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { Channel } from "../../../domain/types";
import {
  AUTO_CHECK_MAX,
  CHECK_FRESH_MS,
  useAutoAvailabilityCheck,
  type AutoCheckOptions,
} from "../useAutoAvailabilityCheck";

const mockNetwork = jest.fn();
jest.mock("expo-network", () => ({
  getNetworkStateAsync: () => mockNetwork(),
}));
const mockCheck = jest.fn();
jest.mock("../../source/availability", () => ({
  checkChannels: (...args: unknown[]) => mockCheck(...args),
}));

const channel = (id: string, extra: Partial<Channel> = {}) =>
  ({
    id,
    streamUrl: `https://a.example.com/${id}`,
    active: true,
    checkedAt: null,
    ...extra,
  }) as Channel;

function options(more: Partial<AutoCheckOptions> = {}): AutoCheckOptions {
  return {
    filterKey: "news",
    listComplete: true,
    channels: [channel("a"), channel("b")],
    paused: false,
    remoteAllowed: true,
    mobileWarning: true,
    mobileAccepted: false,
    save: jest.fn(async () => {}),
    onFinished: jest.fn(),
    ...more,
  };
}

beforeEach(() => {
  mockNetwork
    .mockReset()
    .mockResolvedValue({ type: "WIFI", isConnected: true });
  mockCheck.mockReset().mockImplementation(async (targets: Channel[]) =>
    targets.map((target) => ({
      channelId: target.id,
      streamUrl: target.streamUrl,
      ok: target.id !== "b",
    })),
  );
});

test("a category switch checks the shown channels once and re-sorts once", async () => {
  const opts = options();
  const { rerender } = await renderHook(
    (hookOptions: AutoCheckOptions) => useAutoAvailabilityCheck(hookOptions),
    {
      initialProps: opts,
    },
  );
  await waitFor(() => expect(opts.onFinished).toHaveBeenCalledTimes(1));
  expect(
    mockCheck.mock.calls[0][0].map((checked: Channel) => checked.id),
  ).toEqual(["a", "b"]);
  expect(opts.save).toHaveBeenCalledWith([
    { channelId: "a", streamUrl: "https://a.example.com/a", ok: true },
    { channelId: "b", streamUrl: "https://a.example.com/b", ok: false },
  ]);
  // The reload after re-sorting must not start another sweep.
  await act(async () => rerender({ ...opts, listComplete: false }));
  await act(async () => rerender({ ...opts, listComplete: true }));
  expect(mockCheck).toHaveBeenCalledTimes(1);
});

test("no category, no consent, playback or an unconfirmed metered network: nothing runs", async () => {
  for (const more of [
    { filterKey: null },
    { remoteAllowed: false },
    { paused: true },
    { listComplete: false },
  ]) {
    const opts = options(more);
    await renderHook(() => useAutoAvailabilityCheck(opts));
  }
  mockNetwork.mockResolvedValue({ type: "CELLULAR", isConnected: true });
  const metered = options({ filterKey: "metered" });
  await renderHook(() => useAutoAvailabilityCheck(metered));
  await act(async () => {});
  expect(mockCheck).not.toHaveBeenCalled();
  const accepted = options({ filterKey: "ok", mobileAccepted: true });
  await renderHook(() => useAutoAvailabilityCheck(accepted));
  await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
});

test("recently checked channels are skipped and at most AUTO_CHECK_MAX run", async () => {
  const fresh = channel("fresh", { checkedAt: Date.now() - 1000 });
  const stale = channel("stale", {
    checkedAt: Date.now() - CHECK_FRESH_MS - 1,
  });
  const many = Array.from({ length: AUTO_CHECK_MAX + 5 }, (_unused, index) =>
    channel(`c${index}`),
  );
  const opts = options({ channels: [fresh, stale, ...many] });
  await renderHook(() => useAutoAvailabilityCheck(opts));
  await waitFor(() => expect(mockCheck).toHaveBeenCalled());
  const ids = mockCheck.mock.calls[0][0].map((checked: Channel) => checked.id);
  expect(ids).not.toContain("fresh");
  expect(ids[0]).toBe("stale");
  expect(ids).toHaveLength(AUTO_CHECK_MAX);
});

test("switching category aborts the running sweep without re-sorting", async () => {
  let signal: AbortSignal | undefined;
  mockCheck.mockImplementationOnce(
    (_targets: Channel[], checkOptions: { signal: AbortSignal }) => {
      signal = checkOptions.signal;
      return new Promise((resolve) =>
        checkOptions.signal.addEventListener("abort", () => resolve([])),
      );
    },
  );
  const opts = options();
  const { rerender } = await renderHook(
    (hookOptions: AutoCheckOptions) => useAutoAvailabilityCheck(hookOptions),
    {
      initialProps: opts,
    },
  );
  await waitFor(() => expect(signal).toBeDefined());
  await act(async () =>
    rerender({ ...opts, filterKey: "sports", channels: [] }),
  );
  expect(signal?.aborted).toBe(true);
  expect(opts.onFinished).not.toHaveBeenCalled();
});
