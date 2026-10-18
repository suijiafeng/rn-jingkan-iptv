import { act, renderHook } from "@testing-library/react-native";
import { usePlayback } from "../src/features/home/usePlayback";
import type { Repository } from "../src/data/repository";
import type { Channel } from "../src/domain/types";

test("a source reconciliation started before zapping cannot replace the newer channel", async () => {
  const first = {
    id: "first",
    groupKey: "first",
    active: true,
    streamUrl: "https://example.com/first",
  } as Channel;
  const second = {
    id: "second",
    groupKey: "second",
    active: true,
    streamUrl: "https://example.com/second",
  } as Channel;
  const getChannel = jest.fn(async (id: string) =>
    id === "first" ? first : second,
  );
  const repo = {
    getChannel,
    listChannelSources: jest.fn(async (key: string) => [
      key === "first" ? first : second,
    ]),
  } as unknown as Repository;
  const { result, unmount } = await renderHook(() =>
    usePlayback({
      repo,
      setError: jest.fn(),
      mounted: { current: true },
      permissionEpoch: { current: 0 },
      guardRemote: async () => true,
      channels: [first, second],
      listSettled: { current: true },
      fullList: { current: Promise.resolve([first, second]) },
    }),
  );
  await act(() => result.current.play(first));
  let finish!: (channel: Channel) => void;
  getChannel.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const old = result.current.reconcilePlayingSources();
  await act(() => result.current.play(second));
  await act(async () => {
    finish(first);
    await old;
  });
  expect(result.current.playing?.id).toBe("second");
  expect(result.current.playingSources.map((row) => row.id)).toEqual([
    "second",
  ]);
  await unmount();
});
