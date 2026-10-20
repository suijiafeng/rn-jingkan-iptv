import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { SettingsScreen } from "../SettingsScreen";

function settings(onMiniPlayerChange = jest.fn()) {
  return (
    <SettingsScreen
      remoteAllowed={false}
      revokePending={false}
      mobileWarning
      artworkAllowed={false}
      artworkSaving={false}
      artworkRevokePending={false}
      onRetryArtworkRevoke={() => {}}
      onArtworkChange={() => {}}
      regionConsented={false}
      regionBusy={false}
      onRevokeRegion={() => {}}
      onManageSources={() => {}}
      onRevoke={() => {}}
      onAllowRemote={() => {}}
      onMobileWarningChange={() => {}}
      swipeReverse={false}
      onSwipeReverseChange={() => {}}
      miniPlayer
      onMiniPlayerChange={onMiniPlayerChange}
      onClearAll={() => {}}
    />
  );
}

test("playback has a mini player switch and no skip-unreachable choice", async () => {
  const change = jest.fn();
  await render(settings(change));
  // Skipping unreachable channels is always on, so it is not offered.
  expect(screen.queryByText("换台时跳过无法连接的频道")).toBeNull();
  const toggle = screen.getByLabelText("小浮窗播放器");
  expect(toggle.props.value).toBe(true);
  await fireEvent(toggle, "valueChange", false);
  expect(change).toHaveBeenCalledWith(false);
});
