import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { Source } from "../../../domain/types";
import { EditSourceView } from "../EditSourceModal";
import type { SourceEdit } from "../useSourceEdit";
import { SourceManagerModal } from "../SourceManagerModal";
import { updatedAgo } from "../SourceCard";

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: jest.requireActual("react-native").View,
}));

const source: Source = {
  id: "source",
  name: "本地节目单",
  kind: "file",
  enabled: true,
  location: "playlist.m3u",
  createdAt: 1,
  lastSuccessAt: 1,
  lastErrorCategory: null,
  revision: 1,
  channelCount: 1,
  addressCount: 1,
  favoriteCount: 0,
  reachableCount: 0,
  unreachableCount: 0,
  lastCheckedAt: null,
};

function fakeEdit(overrides: Partial<SourceEdit> = {}): SourceEdit {
  return {
    name: source.name,
    setName: () => {},
    url: "",
    setUrl: () => {},
    fileName: source.location,
    chooseFile: () => {},
    busy: false,
    error: "",
    dismissError: () => {},
    save: () => {},
    cancel: () => {},
    ...overrides,
  } as SourceEdit;
}

function renderModal(
  kind: "manager" | "rename",
  error?: string,
  onDismissError?: () => void,
) {
  if (kind === "rename") {
    return (
      <EditSourceView
        source={source}
        edit={fakeEdit({ error: error ?? "", dismissError: onDismissError })}
      />
    );
  }
  return (
    <SourceManagerModal
      visible
      sources={[source]}
      check={null}
      summaries={{}}
      error={error}
      onDismissError={onDismissError}
      onClose={() => {}}
      onAdd={() => {}}
      onRename={() => {}}
      onRemove={() => {}}
      onCheck={() => {}}
      onStopCheck={() => {}}
      onEnabledChange={() => {}}
    />
  );
}

test("manager shows a private-by-default empty state and one way to add", async () => {
  const add = jest.fn();
  await render(
    <SourceManagerModal
      visible
      sources={[]}
      check={null}
      summaries={{}}
      onClose={() => {}}
      onAdd={add}
      onRename={() => {}}
      onRemove={() => {}}
      onCheck={() => {}}
      onStopCheck={() => {}}
      onEnabledChange={() => {}}
    />,
  );

  expect(screen.getByText("还没有节目来源")).toBeTruthy();
  // Link or file is picked inside the form; the list offers one entry.
  await fireEvent.press(screen.getByRole("button", { name: "添加节目来源" }));
  expect(add.mock.calls).toEqual([["url"]]);
});

test("manager has one close action and no explanatory copy", async () => {
  const close = jest.fn();
  await render(
    <SourceManagerModal
      visible
      sources={[source]}
      check={null}
      summaries={{}}
      onClose={close}
      onAdd={() => {}}
      onRename={() => {}}
      onRemove={() => {}}
      onCheck={() => {}}
      onStopCheck={() => {}}
      onEnabledChange={() => {}}
    />,
  );

  expect(screen.getByRole("header", { name: "节目来源" })).toBeTruthy();
  expect(screen.queryByText(/缓存|只在你操作时联网|已启用/)).toBeNull();
  // The way out is a pinned top-left back, not a "完成" to guess at.
  expect(screen.queryByRole("button", { name: "完成" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "返回" }));
  expect(close).toHaveBeenCalledTimes(1);
});

test("a card shows every action in one row, with nothing folded away", async () => {
  const rename = jest.fn();
  await render(
    <SourceManagerModal
      visible
      sources={[{ ...source, lastErrorCategory: "network" }]}
      check={null}
      summaries={{}}
      onClose={() => {}}
      onAdd={() => {}}
      onRename={rename}
      onRemove={() => {}}
      onCheck={() => {}}
      onStopCheck={() => {}}
      onEnabledChange={() => {}}
    />,
  );

  // Only something to act on earns a third line.
  expect(screen.getByText("上次刷新未完成，旧频道已保留")).toBeTruthy();
  // 测试连通, 编辑, 删除: no 刷新 or 改名 of their own, no 更多, no 补全语言.
  expect(screen.queryByRole("button", { name: /刷新|改名/ })).toBeNull();
  expect(
    screen.queryByRole("button", { name: /更多操作|补全语言/ }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "编辑" }));
  expect(rename).toHaveBeenCalledWith(
    expect.objectContaining({ id: "source" }),
  );
});

test("manager can disable and re-enable a source", async () => {
  const change = jest.fn();
  const ui = await render(
    <SourceManagerModal
      visible
      sources={[source]}
      check={null}
      summaries={{}}
      onClose={() => {}}
      onAdd={() => {}}
      onRename={() => {}}
      onRemove={() => {}}
      onCheck={() => {}}
      onStopCheck={() => {}}
      onEnabledChange={change}
    />,
  );

  // On and off is a switch, like the settings rows the manager opens from.
  await fireEvent(screen.getByLabelText("停用"), "valueChange", false);
  expect(change).toHaveBeenCalledWith(source, false);

  await ui.rerender(
    <SourceManagerModal
      visible
      sources={[{ ...source, enabled: false }]}
      check={null}
      summaries={{}}
      onClose={() => {}}
      onAdd={() => {}}
      onRename={() => {}}
      onRemove={() => {}}
      onCheck={() => {}}
      onStopCheck={() => {}}
      onEnabledChange={change}
    />,
  );
  // A stopped source keeps every action in place, the unusable ones greyed.
  expect(screen.getByRole("button", { name: "测试连通" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "编辑" })).toBeEnabled();
  await fireEvent(screen.getByLabelText("启用"), "valueChange", true);
  expect(change).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: source.id }),
    true,
  );
});

test.each(["manager", "rename"] as const)(
  "%s modal presents errors and lets the caller dismiss them",
  async (kind) => {
    const dismiss = jest.fn();
    const ui = await render(
      renderModal(kind, "本地资料操作失败，请重试", dismiss),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "本地资料操作失败，请重试",
    );
    await fireEvent.press(screen.getByRole("button", { name: "关闭提示" }));
    expect(dismiss).toHaveBeenCalledTimes(1);

    await ui.rerender(renderModal(kind, "", dismiss));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭提示" })).toBeNull();
  },
);

test.each(["manager"] as const)(
  "%s modal can show an error without a dismiss callback",
  async (kind) => {
    await render(renderModal(kind, "本地资料操作失败，请重试"));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "本地资料操作失败，请重试",
    );
    expect(screen.queryByRole("button", { name: "关闭提示" })).toBeNull();
  },
);

test("a stored check result shows only the unreachable count", async () => {
  const checkedAt = new Date(2026, 9, 19, 14, 38).getTime();
  await render(
    <SourceManagerModal
      visible
      sources={[
        {
          ...source,
          channelCount: 500,
          addressCount: 518,
          reachableCount: 508,
          unreachableCount: 10,
          lastCheckedAt: checkedAt,
        },
      ]}
      check={null}
      summaries={{}}
      onClose={() => {}}
      onAdd={() => {}}
      onRename={() => {}}
      onRemove={() => {}}
      onEnabledChange={() => {}}
      onCheck={() => {}}
      onStopCheck={() => {}}
    />,
  );
  // Channels as the list shows them; checks count addresses.
  expect(screen.getByText(/^500 个频道/)).toBeTruthy();
  // The card stays short: no address count, no link/file label, no icon.
  expect(screen.queryByText(/518 个地址|本地文件|链接/)).toBeNull();
  expect(screen.getByText("10 个地址暂时无法连接")).toBeTruthy();
  expect(screen.getByRole("button", { name: "重新测试连通" })).toBeTruthy();
});

test("update times read as days, not timestamps", () => {
  const now = new Date(2026, 9, 20, 9, 0).getTime();
  expect(updatedAgo(new Date(2026, 9, 20, 1, 0).getTime(), now)).toBe(
    "今天更新",
  );
  expect(updatedAgo(new Date(2026, 9, 19, 23, 0).getTime(), now)).toBe(
    "昨天更新",
  );
  expect(updatedAgo(new Date(2026, 9, 16, 12, 0).getTime(), now)).toBe(
    "4 天前更新",
  );
  expect(updatedAgo(0, now)).toBe("");
});

test("the edit page holds the name and the link, applied by one 保存", async () => {
  const save = jest.fn();
  const setUrl = jest.fn();
  const linked = {
    ...source,
    kind: "url" as const,
    location: "https://a.test/x.m3u",
  };
  await render(
    <EditSourceView
      source={linked}
      edit={fakeEdit({ url: linked.location, save, setUrl })}
    />,
  );
  expect(screen.getByRole("header", { name: "编辑节目来源" })).toBeTruthy();
  expect(screen.getByDisplayValue("本地节目单")).toBeTruthy();
  await fireEvent.changeText(
    screen.getByLabelText("节目单链接"),
    "https://b.test/y.m3u",
  );
  expect(setUrl).toHaveBeenCalledWith("https://b.test/y.m3u");
  // No separate update or preview step.
  expect(screen.queryByRole("button", { name: /更新节目单|预览/ })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "保存" }));
  expect(save).toHaveBeenCalledTimes(1);
});

test("a local list shows its file in place of the link, tapped to change", async () => {
  const chooseFile = jest.fn();
  await render(
    <EditSourceView source={source} edit={fakeEdit({ chooseFile })} />,
  );
  expect(screen.queryByLabelText("节目单链接")).toBeNull();
  await fireEvent.press(
    screen.getByRole("button", { name: "更换文件，当前 playlist.m3u" }),
  );
  expect(chooseFile).toHaveBeenCalledTimes(1);
});

test("switching a source off keeps its warning line, so the card keeps its height", async () => {
  const warned = { ...source, lastCheckedAt: 1, unreachableCount: 3 };
  const modal = (enabled: boolean) => (
    <SourceManagerModal
      visible
      sources={[{ ...warned, enabled }]}
      check={null}
      summaries={{}}
      onClose={() => {}}
      onAdd={() => {}}
      onRename={() => {}}
      onRemove={() => {}}
      onCheck={() => {}}
      onStopCheck={() => {}}
      onEnabledChange={() => {}}
    />
  );
  const ui = await render(modal(true));
  expect(screen.getByText("3 个地址暂时无法连接")).toBeTruthy();
  await ui.rerender(modal(false));
  expect(screen.getByText("3 个地址暂时无法连接")).toBeTruthy();
});
