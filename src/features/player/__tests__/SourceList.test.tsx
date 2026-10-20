import React from "react";
import { render, screen } from "@testing-library/react-native";
import { SourceList } from "../SourceList";
import { first, second } from "./support/playerTestKit";

test("an unreachable source says when it was tested and that picking it retries", async () => {
  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  const stale = {
    ...second,
    checkStatus: "unreachable" as const,
    checkedAt: yesterday,
  };
  await render(
    <SourceList current={first} sources={[first, stale]} onSelect={() => {}} />,
  );
  expect(screen.getByText("昨天测试未连通 · 点选可再试")).toBeTruthy();
  expect(screen.queryByText(/检测/)).toBeNull();
});

test("the playlist name appears only when sources come from several playlists", async () => {
  const ui = await render(
    <SourceList
      current={first}
      sources={[first, second]}
      onSelect={() => {}}
    />,
  );
  // One playlist: its name on every row would just repeat.
  expect(screen.queryByText(/我的节目单/)).toBeNull();

  const other = { ...second, sourceName: "另一份" };
  await ui.rerender(
    <SourceList current={first} sources={[first, other]} onSelect={() => {}} />,
  );
  expect(screen.getByText(/我的节目单/)).toBeTruthy();
  expect(screen.getByText(/另一份/)).toBeTruthy();
});
