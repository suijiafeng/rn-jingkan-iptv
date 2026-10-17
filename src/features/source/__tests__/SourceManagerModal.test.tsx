import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { Source } from "../../../domain/types";
import { RenameSourceModal, SourceManagerModal } from "../SourceManagerModal";

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: jest.requireActual("react-native").View,
}));

const source: Source = {
  id: "source",
  name: "本地节目单",
  kind: "file",
  location: "playlist.m3u",
  createdAt: 1,
  lastSuccessAt: 1,
  lastErrorCategory: null,
  revision: 1,
  channelCount: 1,
  favoriteCount: 0,
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
    />
  );
}

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
