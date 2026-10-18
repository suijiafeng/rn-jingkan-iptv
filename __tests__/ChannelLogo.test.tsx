import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ChannelLogo } from "../src/components/ChannelLogo";
import { channelArtworkUrl } from "../src/domain/channelArtwork";

test.each([
  null,
  "",
  "http://example.com/logo.png",
  "file:///logo.png",
  "data:image/png;base64,x",
  "https://user:token@example.com/logo.png",
  "https://127.0.0.1/logo",
  "https://10.0.0.1/logo",
  "https://[::1]/logo",
  "https://printer.local/logo",
  "https://example.com:22/logo",
  "https://example.com/" + "x".repeat(4096),
])("rejects unsafe artwork URL case %#", (uri) => {
  expect(channelArtworkUrl(uri)).toBeNull();
});

test("only consented HTTPS images mount and failures fall back to the title's first character", async () => {
  const uri = "https://example.com/logo.png?token=opaque";
  expect(channelArtworkUrl(uri)).toBe(uri);
  const ui = await render(
    <ChannelLogo uri={uri} title="山野纪实" enabled={false} />,
  );
  expect(
    screen.queryByTestId("channel-logo-image", { includeHiddenElements: true }),
  ).toBeNull();
  expect(screen.getByText("山", { includeHiddenElements: true })).toBeTruthy();
  await ui.rerender(<ChannelLogo uri={uri} title="山野纪实" enabled />);
  expect(
    screen.getByTestId("channel-logo-image", { includeHiddenElements: true })
      .props.source,
  ).toEqual({ uri });
  await fireEvent(
    screen.getByTestId("channel-logo-image", { includeHiddenElements: true }),
    "error",
    { nativeEvent: { error: "failed" } },
  );
  expect(
    screen.queryByTestId("channel-logo-image", { includeHiddenElements: true }),
  ).toBeNull();
  expect(screen.getByText("山", { includeHiddenElements: true })).toBeTruthy();
});

test("changing URI resets failure, and a stale callback cannot hide or revive the replacement", async () => {
  const ui = await render(
    <ChannelLogo uri="https://example.com/a.png" title="山野纪实" enabled />,
  );
  const oldError = screen.getByTestId("channel-logo-image", {
    includeHiddenElements: true,
  }).props.onError;
  await ui.rerender(
    <ChannelLogo uri="https://example.com/b.png" title="山野纪实" enabled />,
  );
  await act(() => oldError());
  expect(
    screen.getByTestId("channel-logo-image", { includeHiddenElements: true })
      .props.source.uri,
  ).toBe("https://example.com/b.png");
  await fireEvent(
    screen.getByTestId("channel-logo-image", { includeHiddenElements: true }),
    "error",
    {},
  );
  await act(() => oldError());
  expect(
    screen.queryByTestId("channel-logo-image", { includeHiddenElements: true }),
  ).toBeNull();
  await ui.rerender(
    <ChannelLogo uri="https://example.com/c.png" title="" enabled />,
  );
  expect(
    screen.getByTestId("channel-logo-image", { includeHiddenElements: true }),
  ).toBeTruthy();
  await ui.rerender(
    <ChannelLogo uri="https://example.com/c.png" title="" enabled={false} />,
  );
  expect(screen.getByText("台", { includeHiddenElements: true })).toBeTruthy();
});
