import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { Source } from "../../../domain/types";
import { RenameSourceModal } from "../RenameSourceModal";
import { SourceManagerModal } from "../SourceManagerModal";

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
  expect(screen.getByText(/不会自动添加远程来源/)).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "添加链接" }));
  await fireEvent.press(screen.getByRole("button", { name: "导入文件" }));
  expect(add.mock.calls).toEqual([["url"], ["file"]]);
});

test("manager separates source identity, status and actions", async () => {
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

  expect(screen.getByText("文件")).toBeTruthy();
  expect(screen.getByText("需注意")).toBeTruthy();
  expect(screen.getByText("上次刷新未完成，旧频道已保留。")).toBeTruthy();
  await fireEvent.press(
    screen.getByRole("button", { name: "重新解析 / 更换文件" }),
  );
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
  expect(screen.getByText("不参与频道与播放")).toBeTruthy();
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

test("a stored check result is shown without a check in this session", async () => {
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
  expect(
    screen.getByText("上次检测 2026/10/19 14:38 · 可访问 508 个，不可达 10 个"),
  ).toBeTruthy();
});
