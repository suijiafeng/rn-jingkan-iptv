import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button } from "../src/components/ui";
import { ChannelRow } from "../src/components/ChannelRow";
import { Channel } from "../src/domain/types";
const channel: Channel = {
  id: "1",
  sourceId: "s",
  sourceName: "自己的目录",
  identityKey: "id:1",
  name: "山野纪实",
  groupName: "纪录片",
  tvgId: "1",
  logoUrl: null,
  streamUrl: "https://example.com/live.m3u8",
  sortIndex: 0,
  active: true,
  lastSeenRevision: 1,
  favorite: false,
  lastPlayedAt: null,
  checkStatus: null,
  checkedAt: null,
};
test("disabled submit cannot run and retains clear accessibility state", async () => {
  const run = jest.fn();
  await render(<Button label="正在保存" disabled onPress={run} />);
  expect(screen.getByRole("button", { name: "正在保存" })).toBeDisabled();
  await fireEvent.press(screen.getByText("正在保存"));
  expect(run).not.toHaveBeenCalled();
});
test("favorite is independent from channel playback", async () => {
  const play = jest.fn(),
    favorite = jest.fn();
  await render(
    <ChannelRow channel={channel} onPlay={play} onFavorite={favorite} />,
  );
  expect(
    screen.queryByRole("button", { name: "删除山野纪实的观看记录" }),
  ).toBeNull();
  await fireEvent.press(screen.getByLabelText("收藏山野纪实"));
  expect(favorite).toHaveBeenCalledTimes(1);
  expect(play).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText("山野纪实，播放"));
  expect(play).toHaveBeenCalledTimes(1);
});
test("inactive favorite never plays a same-name replacement", async () => {
  const play = jest.fn();
  await render(
    <ChannelRow
      channel={{ ...channel, active: false, favorite: true }}
      onPlay={play}
      onFavorite={() => {}}
    />,
  );
  expect(screen.getByText("来源已不再提供")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("山野纪实，来源已不再提供"));
  expect(play).not.toHaveBeenCalled();
});

test("recent management hides favorite controls and disables playback while allowing deletion", async () => {
  const play = jest.fn();
  const favorite = jest.fn();
  const remove = jest.fn();
  await render(
    <ChannelRow
      channel={channel}
      onPlay={play}
      onFavorite={favorite}
      onRemoveRecent={remove}
    />,
  );
  expect(screen.queryByLabelText("收藏山野纪实")).toBeNull();
  expect(
    screen.getByRole("button", { name: "山野纪实，观看记录" }),
  ).toBeDisabled();
  await fireEvent.press(
    screen.getByRole("button", { name: "山野纪实，观看记录" }),
  );
  expect(play).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole("button", { name: "删除山野纪实的观看记录" }),
  );
  expect(remove).toHaveBeenCalledTimes(1);
  expect(play).not.toHaveBeenCalled();
  expect(favorite).not.toHaveBeenCalled();
});

test("unavailable recent entries remain deletable and deletion is disabled while busy", async () => {
  const remove = jest.fn();
  const rowProps = {
    channel: { ...channel, active: false },
    onPlay: jest.fn(),
    onFavorite: jest.fn(),
    onRemoveRecent: remove,
  };
  const ui = await render(<ChannelRow {...rowProps} />);
  const label = "删除山野纪实的观看记录";
  expect(screen.getByRole("button", { name: label })).not.toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: label }));
  expect(remove).toHaveBeenCalledTimes(1);
  await ui.rerender(<ChannelRow {...rowProps} recentBusy />);
  expect(screen.getByRole("button", { name: label })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: label }));
  expect(remove).toHaveBeenCalledTimes(1);
  expect(rowProps.onPlay).not.toHaveBeenCalled();
  expect(rowProps.onFavorite).not.toHaveBeenCalled();
});
