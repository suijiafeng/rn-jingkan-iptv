import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ChannelRow } from "../ChannelRow";
import type { Channel } from "../../domain/types";

const channel: Channel = {
  id: "c",
  identityKey: "c",
  sourceId: "s",
  sourceName: "来源",
  active: true,
  lastSeenRevision: 1,
  lastPlayedAt: null,
  checkStatus: "unreachable",
  checkedAt: 1,
  name: "山野纪实",
  groupName: "纪录片",
  streamUrl: "https://example.test/c.m3u8",
  logoUrl: null,
  tvgId: null,
  sortIndex: 0,
  favorite: false,
};

test("an unreachable channel shows a clear warning and remains playable", async () => {
  const onPlay = jest.fn();
  await render(
    <ChannelRow channel={channel} onPlay={onPlay} onFavorite={jest.fn()} />,
  );
  expect(screen.getByText("暂时无法连接")).toBeTruthy();
  const play = screen.getByRole("button", {
    name: "山野纪实，暂时无法连接，播放",
  });
  fireEvent.press(play);
  expect(onPlay).toHaveBeenCalledWith(channel);
});
