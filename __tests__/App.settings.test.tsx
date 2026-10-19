import React from "react";
import {
  mockPlayerProps,
  repo,
  setupFacetCatalog,
  resetAppMocks,
} from "./support/appTestKit";
import { AccessibilityInfo, Alert } from "react-native";
import { hideToast } from "../src/components/Toast";
import {
  answerConsent,
  currentConsent,
} from "../src/features/common/ConsentDialog";
import {
  fireEvent,
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import App from "../src/App";
import { openRepository } from "../src/data/repository";
import { downloadPlaylist } from "../src/data/importIO";

beforeEach(resetAppMocks);

test("startup failure can retry opening local data without restarting", async () => {
  (openRepository as jest.Mock).mockRejectedValueOnce(new Error("unavailable"));
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByText("重新打开本地资料")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByText("重新打开本地资料"));
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
  expect(openRepository).toHaveBeenCalledTimes(2);
});
test("loading does not invite users to import before local data has loaded", async () => {
  let finish!: (value: never[]) => void;
  repo.listSources.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(<App />);
  await waitFor(() => expect(screen.getByText("正在读取频道…")).toBeTruthy());
  expect(screen.queryByText("从一份节目单开始")).toBeNull();
  await act(async () => finish([]));
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
});
test("failed list reads have a working retry", async () => {
  repo.listSources.mockRejectedValueOnce(new Error("read failed"));
  await render(<App />);
  await waitFor(() => expect(screen.getByText("重新读取频道")).toBeTruthy());
  expect(screen.queryByText("从一份节目单开始")).toBeNull();
  await fireEvent.press(screen.getByText("重新读取频道"));
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
});
test("an obsolete list failure cannot replace the current tab results", async () => {
  let fail!: (error: Error) => void;
  repo.listSources.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  await render(<App />);
  await waitFor(() => expect(screen.getByText("正在读取频道…")).toBeTruthy());
  await fireEvent.press(screen.getByRole("tab", { name: "最近" }));
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
  await act(async () => fail(new Error("late failure")));
  expect(screen.queryByText("重新读取频道")).toBeNull();
});
test("settings permission write failures are shown without granting access", async () => {
  repo.setSetting.mockRejectedValueOnce(new Error("write failed"));
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByText("设置"));
  await fireEvent.press(screen.getByText("了解说明并允许"));
  await fireEvent.press(await screen.findByRole("button", { name: "允许" }));
  await waitFor(() =>
    expect(screen.getByText("联网许可未保存，请重试")).toBeTruthy(),
  );
  expect(screen.getByText("未允许")).toBeTruthy();
  expect(downloadPlaylist).not.toHaveBeenCalled();
});
test("failed revocation stays blocked and can persist a retry without another consent prompt", async () => {
  let persistedAllowed = true;
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? persistedAllowed : fallback,
  );
  (repo.setSetting as jest.Mock).mockImplementation(async (key, value) => {
    if (key === "remoteAllowed") persistedAllowed = value;
  });
  repo.setSetting.mockRejectedValueOnce(new Error("disk unavailable"));
  const alert = jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons) =>
      buttons?.[1].onPress?.(),
    );
  const ui = await render(<App />);
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByText("设置"));
  await fireEvent.press(screen.getByRole("button", { name: "撤销联网许可" }));
  await waitFor(() => expect(screen.getByText("重试保存撤销")).toBeTruthy());
  expect(persistedAllowed).toBe(true);
  expect(screen.queryByText("了解说明并允许")).toBeNull();
  expect(screen.getByText("撤销尚未保存，保存前许可仍可能有效")).toBeTruthy();
  await fireEvent.press(screen.getByText("重试保存撤销"));
  await waitFor(() => expect(screen.getByText("了解说明并允许")).toBeTruthy());
  expect(alert).toHaveBeenCalledTimes(1);
  expect(persistedAllowed).toBe(false);
  expect(repo.setSetting.mock.calls).toEqual([
    ["remoteAllowed", false],
    ["remoteAllowed", false],
  ]);
  expect(
    screen.queryByText("许可已在本次运行中撤销，但未能保存。请重试撤销。"),
  ).toBeNull();
  await ui.unmount();
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByText("从一份节目单开始")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByText("设置"));
  expect(screen.getByText("未允许")).toBeTruthy();
  expect(downloadPlaylist).not.toHaveBeenCalled();
});
test("channel artwork stays absent by default and a failed consent save does not mount images", async () => {
  setupFacetCatalog();
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : fallback,
  );
  (repo.setSetting as jest.Mock).mockImplementation(async (key) => {
    if (key === "artworkAllowed") throw new Error("disk unavailable");
  });
  jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons) =>
      buttons?.[1]?.onPress?.(),
    );
  await render(<App />);
  await screen.findByLabelText("中文新闻，播放");
  expect(
    screen.queryByTestId("channel-logo-image", { includeHiddenElements: true }),
  ).toBeNull();
  await fireEvent.press(screen.getByRole("tab", { name: "设置" }));
  await fireEvent(screen.getByLabelText("显示频道台标"), "valueChange", true);
  await waitFor(() => expect(currentConsent()?.title).toBe("显示频道台标？"));
  await act(async () => answerConsent("allow"));
  expect(await screen.findByText("台标开启未保存，请重试")).toBeTruthy();
  expect(screen.getByLabelText("显示频道台标").props.value).toBe(false);
  await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
  await screen.findByLabelText("中文新闻，播放");
  expect(
    screen.queryByTestId("channel-logo-image", { includeHiddenElements: true }),
  ).toBeNull();
});

test("revoking networking removes previously authorized channel artwork", async () => {
  setupFacetCatalog();
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" || key === "artworkAllowed" ? true : fallback,
  );
  jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons) =>
      buttons?.[1]?.onPress?.(),
    );
  await render(<App />);
  await screen.findByLabelText("中文新闻，播放");
  expect(
    screen.getAllByTestId("channel-logo-image", { includeHiddenElements: true })
      .length,
  ).toBeGreaterThan(0);
  await fireEvent.press(screen.getByRole("tab", { name: "设置" }));
  await fireEvent.press(screen.getByRole("button", { name: "撤销联网许可" }));
  await screen.findByRole("button", { name: "了解说明并允许" });
  await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
  await screen.findByLabelText("中文新闻，播放");
  expect(
    screen.queryByTestId("channel-logo-image", { includeHiddenElements: true }),
  ).toBeNull();
});

test("failed artwork revocation unmounts images immediately and retries saving false without re-enabling", async () => {
  setupFacetCatalog();
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" || key === "artworkAllowed" ? true : fallback,
  );
  repo.setSetting.mockRejectedValueOnce(new Error("disk unavailable"));
  const alert = jest.spyOn(Alert, "alert");
  await render(<App />);
  await screen.findByLabelText("中文新闻，播放");
  expect(
    screen.getAllByTestId("channel-logo-image", { includeHiddenElements: true })
      .length,
  ).toBeGreaterThan(0);
  await fireEvent.press(screen.getByRole("tab", { name: "设置" }));
  await fireEvent(screen.getByLabelText("显示频道台标"), "valueChange", false);
  expect(
    await screen.findByRole("button", { name: "重试保存台标关闭" }),
  ).toBeTruthy();
  expect(screen.getByLabelText("显示频道台标").props.value).toBe(false);
  expect(screen.getByLabelText("显示频道台标").props.disabled).toBe(true);
  await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
  await screen.findByLabelText("中文新闻，播放");
  expect(
    screen.queryByTestId("channel-logo-image", { includeHiddenElements: true }),
  ).toBeNull();
  await fireEvent.press(screen.getByRole("tab", { name: "设置" }));
  await fireEvent.press(
    screen.getByRole("button", { name: "重试保存台标关闭" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "重试保存台标关闭" }),
    ).toBeNull(),
  );
  expect(screen.getByLabelText("显示频道台标").props.value).toBe(false);
  expect(screen.getByLabelText("显示频道台标").props.disabled).toBe(false);
  expect(repo.setSetting.mock.calls).toEqual([
    ["artworkAllowed", false],
    ["artworkAllowed", false],
  ]);
  expect(alert).not.toHaveBeenCalled();
});

test.each(["revocation", "unmount"])(
  "a late artwork consent cannot enable images after %s",
  async (action) => {
    setupFacetCatalog();
    repo.getSetting.mockImplementation(async (key, fallback) =>
      key === "remoteAllowed" ? true : fallback,
    );
    jest
      .spyOn(Alert, "alert")
      .mockImplementation((_title, _message, buttons) =>
        buttons?.[1]?.onPress?.(),
      );
    const ui = await render(<App />);
    await screen.findByLabelText("中文新闻，播放");
    await fireEvent.press(screen.getByRole("tab", { name: "设置" }));
    await fireEvent(screen.getByLabelText("显示频道台标"), "valueChange", true);
    await waitFor(() => expect(currentConsent()?.title).toBe("显示频道台标？"));
    if (action === "revocation") {
      await fireEvent.press(
        screen.getByRole("button", { name: "撤销联网许可" }),
      );
      await screen.findByRole("button", { name: "了解说明并允许" });
    } else await ui.unmount();
    await act(async () => answerConsent("allow"));
    expect(repo.setSetting).not.toHaveBeenCalledWith("artworkAllowed", true);
    if (action === "revocation") {
      await fireEvent.press(screen.getByRole("tab", { name: "频道" }));
      await screen.findByLabelText("中文新闻，播放");
      expect(
        screen.queryByTestId("channel-logo-image", {
          includeHiddenElements: true,
        }),
      ).toBeNull();
    }
  },
);

test("a first run opens the guide, which can lead straight to adding a link", async () => {
  repo.getSetting.mockImplementation(async (_key, fallback) => fallback);
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByText("播放你自己添加的节目单。")).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole("button", { name: "添加节目单链接" }));
  expect(repo.setSetting).toHaveBeenCalledWith("guideSeen", true);
  await waitFor(() =>
    expect(screen.queryByText("播放你自己添加的节目单。")).toBeNull(),
  );
  expect(screen.getByLabelText("节目单链接")).toBeTruthy();
});

test("a user with sources never sees the guide but can reopen it in settings", async () => {
  repo.getSetting.mockImplementation(async (_key, fallback) => fallback);
  (repo.listSources as jest.Mock).mockResolvedValue([
    {
      id: "s1",
      name: "家里",
      kind: "url",
      location: "https://a.test/a.m3u",
      enabled: true,
    },
  ]);
  await render(<App />);
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "设置" })).toBeTruthy(),
  );
  expect(screen.queryByText("播放你自己添加的节目单。")).toBeNull();
  await fireEvent.press(screen.getByRole("tab", { name: "设置" }));
  await fireEvent.press(screen.getByText("使用指引"));
  expect(screen.getByText("播放你自己添加的节目单。")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "稍后再说" }));
  await waitFor(() =>
    expect(screen.queryByText("播放你自己添加的节目单。")).toBeNull(),
  );
});

test("revoking network access while playing stops the player and says so in a toast", async () => {
  setupFacetCatalog();
  repo.getSetting.mockImplementation(async (key, fallback) =>
    key === "remoteAllowed" ? true : key === "guideSeen" ? true : fallback,
  );
  jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons) =>
      buttons?.[1]?.onPress?.(),
    );
  jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => {});
  await render(<App />);
  await fireEvent.press(await screen.findByLabelText("中文新闻，播放"));
  await waitFor(() => expect(mockPlayerProps).toHaveBeenCalled());
  // Dock the player so the page (and its tabs) is reachable again.
  await act(async () => mockPlayerProps.mock.calls.at(-1)![0].onMinimize());
  await fireEvent.press(screen.getByRole("tab", { name: "设置" }));
  // The toast is announced, not focusable, so it sits outside the a11y tree.
  const hidden = { includeHiddenElements: true };
  expect(screen.queryByText("已撤销联网许可，播放已停止", hidden)).toBeNull();
  mockPlayerProps.mockClear();
  await fireEvent.press(screen.getByRole("button", { name: "撤销联网许可" }));
  expect(
    await screen.findByText("已撤销联网许可，播放已停止", hidden),
  ).toBeTruthy();
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
    "已撤销联网许可，播放已停止",
  );
  await act(async () => {});
  expect(mockPlayerProps).not.toHaveBeenCalled();
  hideToast();
});
