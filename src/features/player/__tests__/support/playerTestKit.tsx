/**
 * Shared mocks and fixtures for the PlayerScreen suites; not a test file.
 * Import it before PlayerScreen so its jest.mock calls register first.
 */
import React from "react";
import { AppState } from "react-native";
import type { ChannelSheetProps, PlayerScreenProps } from "../../PlayerScreen";
import type { HeaderProps } from "../../../channel/ChannelListParts";
import type { Channel } from "../../../../domain/types";

export const mockNetworkCheck = jest.fn();
export const mockNetworkListeners = new Set<(state: object) => void>();
export const mockMounts = jest.fn();
export const mockUnmounts = jest.fn();
export const mockLock = jest.fn();
export const mockSafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
jest.mock("expo-network", () => ({
  getNetworkStateAsync: () => mockNetworkCheck(),
  addNetworkStateListener: (listener: (state: object) => void) => {
    mockNetworkListeners.add(listener);
    return { remove: () => mockNetworkListeners.delete(listener) };
  },
}));
jest.mock("expo-screen-orientation", () => ({
  OrientationLock: { DEFAULT: 0, PORTRAIT_UP: 1, LANDSCAPE: 2 },
  getOrientationLockAsync: async () => 0,
  lockAsync: (lock: number) => mockLock(lock),
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView:
    jest.requireActual<typeof import("react-native")>("react-native").View,
  useSafeAreaInsets: () => mockSafeAreaInsets,
}));
/** Stand-in native player the overlay drives through the media handle. */
export const mockNative = {
  isLive: true,
  duration: 30,
  currentTime: 0,
  play: jest.fn(),
  pause: jest.fn(),
};
export type MockController = {
  nativeStarted: (id: number) => void;
  nativeStatus: (id: number, status: string, failure?: string) => void;
};
export let mockAttempt: {
  attemptId: number;
  controller: MockController;
} | null = null;
jest.mock("../../NativeAttempt", () => ({
  NativeAttempt: function MockNativeAttempt(props: {
    attemptId: number;
    uri: string;
    controller: MockController;
    media?: {
      attach: (player: unknown) => void;
      sample: (player: unknown) => void;
      detach: (player: unknown) => void;
    };
  }) {
    const { View } =
      jest.requireActual<typeof import("react-native")>("react-native");
    const { useEffect } = jest.requireActual<typeof import("react")>("react");
    mockAttempt = props;
    useEffect(() => {
      mockMounts(props.uri);
      return () => {
        mockUnmounts(props.uri);
      };
    }, [props.uri]);
    const { media } = props;
    useEffect(() => {
      if (!media) return;
      media.attach(mockNative);
      media.sample(mockNative);
      return () => media.detach(mockNative);
    }, [media]);
    return <View testID="mock-native-attempt" />;
  },
}));
export const first: Channel = {
  id: "first",
  identityKey: "one",
  sourceId: "source",
  sourceName: "我的节目单",
  active: true,
  lastSeenRevision: 1,
  lastPlayedAt: null,
  checkStatus: null,
  checkedAt: null,
  name: "山野纪实",
  groupName: "纪录片",
  streamUrl: "https://example.test/one.m3u8",
  logoUrl: null,
  tvgId: null,
  sortIndex: 0,
  favorite: false,
};
export const second: Channel = {
  ...first,
  id: "second",
  identityKey: "two",
  name: "自然之声",
  streamUrl: "https://example.test/two.m3u8",
  sortIndex: 1,
  favorite: true,
};
/** The page's state as App hands it to the sheet. */
export function sheet(
  channels: Channel[],
  more: Partial<
    Pick<HeaderProps, "tab" | "search" | "facets"> &
      Pick<ChannelSheetProps, "rangeKey" | "loading">
  > = {},
): ChannelSheetProps {
  const tab = more.tab ?? "all";
  return {
    filters: {
      tab,
      sources: [],
      channelCount: channels.length,
      search: more.search ?? "",
      sourceId: "",
      facets: more.facets ?? { countries: [], languages: [], contents: [] },
      facetSelection: { country: null, language: null, content: null },
      onSearchChange: jest.fn(),
      onClearSearch: jest.fn(),
      onSourceChange: jest.fn(),
      onFacetChange: jest.fn(),
      onClearRecent: jest.fn(),
      recentBusy: false,
      recentEditing: false,
      onToggleRecentEditing: jest.fn(),
      recentCount: 0,
    },
    onTabChange: jest.fn(),
    channels,
    rangeKey: more.rangeKey === undefined ? tab : more.rangeKey,
    loading: more.loading ?? false,
    onLocate: jest.fn(),
  };
}
export const props = (
  more: Partial<PlayerScreenProps> = {},
): PlayerScreenProps => ({
  channel: first,
  channels: [first, second],
  sheet: sheet(more.channels ?? [first, second]),
  remoteAllowed: true,
  mobileWarning: true,
  onSelect: jest.fn(),
  onClose: jest.fn(),
  onFavorite: jest.fn(),
  onStarted: jest.fn(),
  ...more,
  sources: more.sources ?? [more.channel ?? first],
  onSelectSource: more.onSelectSource ?? jest.fn(),
});
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockNative, { isLive: true, duration: 30, currentTime: 0 });
  mockAttempt = null;
  Object.assign(mockSafeAreaInsets, {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  mockNetworkListeners.clear();
  mockNetworkCheck.mockResolvedValue({ type: "WIFI", isConnected: true });
  mockLock.mockResolvedValue(undefined);
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    writable: true,
    value: "active",
  });
});
