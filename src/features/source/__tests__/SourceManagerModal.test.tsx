import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { Source } from "../../../domain/types";
import { RenameSourceModal } from "../RenameSourceModal";
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
  favoriteCount: 0,
  reachableCount: 0,
  unreachableCount: 0,
  lastCheckedAt: null,
};

function renderModal(
  kind: "manager" | "rename",
  error?: string,
  onDismissError?: () => void,
) {
  if (kind === "rename") {
    return (
      <RenameSourceModal
        source={source}
        text={source.name}
        error={error}
        onDismissError={onDismissError}
        onChangeText={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
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
      onRefresh={() => {}}
      onRename={() => {}}
      onRemove={() => {}}
      onCheck={() => {}}
      onStopCheck={() => {}}
      onEnabledChange={() => {}}
    />
  );
}

test("manager shows a private-by-default empty state and both add methods", async () => {
  const add = jest.fn();
  await render(
    <SourceManagerModal
      visible
      sources={[]}
      check={null}
      summaries={{}}
      onClose={() => {}}
      onAdd={add}
      onRefresh={() => {}}
      onRename={() => {}}
      onRemove={() => {}}
      onCheck={() => {}}
      onStopCheck={() => {}}
      onEnabledChange={() => {}}
    />,
  );

  expect(screen.getByText("还没有节目来源")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "添加链接" }));
  await fireEvent.press(screen.getByRole("button", { name: "导入文件" }));
  expect(add.mock.calls).toEqual([["url"], ["file"]]);
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
      onRefresh={() => {}}
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

test("a card keeps two everyday actions in view and folds the rest", async () => {
  const refresh = jest.fn();
  const rename = jest.fn();
  await render(
    <SourceManagerModal
      visible
      sources={[{ ...source, lastErrorCategory: "network" }]}
      check={null}
      summaries={{}}
      onClose={() => {}}
      onAdd={() => {}}
      onRefresh={refresh}
      onRename={rename}
      onRemove={() => {}}
      onCheck={() => {}}
      onStopCheck={() => {}}
      onEnabledChange={() => {}}
    />,
  );

  // Only something to act on earns a third line.
  expect(screen.getByText("上次刷新未完成，旧频道已保留")).toBeTruthy();
  await fireEvent.press(
    screen.getByRole("button", { name: "重新解析 / 更换文件" }),
  );
  expect(screen.queryByRole("button", { name: "改名" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "更多操作" }));
  await fireEvent.press(screen.getByRole("button", { name: "改名" }));
  expect(refresh).toHaveBeenCalledWith(
    expect.objectContaining({ id: "source" }),
  );
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
      onRefresh={() => {}}
      onRename={() => {}}
      onRemove={() => {}}
      onCheck={() => {}}
      onStopCheck={() => {}}
      onEnabledChange={change}
    />,
  );

  await fireEvent.press(screen.getByRole("button", { name: "更多操作" }));
  await fireEvent.press(screen.getByRole("button", { name: "停用" }));
  expect(change).toHaveBeenCalledWith(source, false);

  await ui.rerender(
    <SourceManagerModal
      visible
      sources={[{ ...source, enabled: false }]}
      check={null}
      summaries={{}}
      onClose={() => {}}
      onAdd={() => {}}
      onRefresh={() => {}}
      onRename={() => {}}
      onRemove={() => {}}
      onCheck={() => {}}
      onStopCheck={() => {}}
      onEnabledChange={change}
    />,
  );
  expect(screen.getByText("已停用")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "启用" }));
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

test.each(["manager", "rename"] as const)(
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
          reachableCount: 508,
          unreachableCount: 10,
          lastCheckedAt: checkedAt,
        },
      ]}
      check={null}
      summaries={{}}
      onClose={() => {}}
      onAdd={() => {}}
      onRefresh={() => {}}
      onRename={() => {}}
      onRemove={() => {}}
      onEnabledChange={() => {}}
      onCheck={() => {}}
      onStopCheck={() => {}}
    />,
  );
  expect(screen.getByText(/1 个频道 · 10 个暂时无法连接/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "重新检测" })).toBeTruthy();
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
