import React from "react";
import { render, screen } from "@testing-library/react-native";
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

test("an unreachable channel is dimmed without a text tag, but still spoken", async () => {
  await render(
    <ChannelRow channel={channel} onPlay={jest.fn()} onFavorite={jest.fn()} />,
  );
  expect(screen.queryByText("不可用")).toBeNull();
  expect(
    screen.getByRole("button", { name: "山野纪实，不可用，播放" }),
  ).toBeTruthy();
});
