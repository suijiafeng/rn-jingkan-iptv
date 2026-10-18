import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Keyboard,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Channel, Source } from "./domain/types";
import {
  effectiveCountry,
  useRegionPreference,
} from "./features/region/useRegionPreference";
import { Button, Heading, Notice } from "./components/ui";
import { colors, styles as theme } from "./theme";
import { useAutoAvailabilityCheck } from "./features/channel/useAutoAvailabilityCheck";
import { useChannelFilters } from "./features/channel/useChannelFilters";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import {
  BottomTabs,
  type HeaderProps,
  type ListTab,
  type Tab,
} from "./features/channel/ChannelListParts";
import { useAppSettings } from "./features/home/useAppSettings";
import { useChannelListData } from "./features/home/useChannelListData";
import { usePlayback } from "./features/home/usePlayback";
import { useSourceImport } from "./features/home/useSourceImport";
import { useSourceTasks } from "./features/home/useSourceTasks";
import { useChannelActions } from "./features/home/useChannelActions";
import { useDataControls } from "./features/home/useDataControls";
import { ChannelListPage } from "./features/home/ChannelListPage";
import { HomePlayer } from "./features/home/HomePlayer";
import { SourceDialogs } from "./features/home/SourceDialogs";

/**
 * The home screen: bottom tabs over the channel list or settings, the source
 * dialogs, and the player (full screen or docked as a bar above the tabs).
 * State and its rules live in the hooks under features/home.
 */
export default function App() {
  const [error, setError] = useState(""),
    [tab, setTab] = useState<Tab>("all"),
    [manage, setManage] = useState(false),
    [rename, setRename] = useState<Source | null>(null),
    // Height of the tab bar the docked player sits above.
    [tabsHeight, setTabsHeight] = useState(0);
  const settings = useAppSettings({ setError, setTab });
  const { repo, mounted } = settings;
  // One filter state for the channel page and the player's channel sheet.
  const filters = useChannelFilters();
  const { sourceId, group, language, search, query } = filters;
  const region = useRegionPreference(repo, setError);
  const countryKey = JSON.stringify([
    region.preference.mode,
    region.preference.countryCode,
    region.result.countryCode,
  ]);
  // "定位当前频道" shows every country until the preference changes.
  const countryBypassed = filters.countryBypass === countryKey;
  const list = useChannelListData({
    repo,
    tab,
    sourceId,
    group,
    language,
    query,
    region,
    countryKey,
    countryBypassed,
  });
  const { changed, channels, sources } = list;
  const country = countryBypassed
    ? null
    : effectiveCountry(region.preference, region.result, list.facets.countries);
  const playback = usePlayback({
    repo,
    setError,
    mounted,
    permissionEpoch: settings.permissionEpoch,
    guardRemote: settings.guardRemote,
    channels,
    listSettled: list.listSettled,
    fullList: list.fullList,
  });
  const { playing, playerMini } = playback;
  const actions = useChannelActions({
    repo,
    setError,
    mounted,
    list,
    playback,
  });
  const { recentBusy, recentEditing, setRecentEditing } = actions;
  const importer = useSourceImport({
    repo,
    setError,
    mounted,
    remoteRef: settings.remoteRef,
    guardRemote: settings.guardRemote,
    checkNetwork: settings.checkNetwork,
    reconcilePlayingSources: playback.reconcilePlayingSources,
    changed,
    onImported: () => {
      setTab("all");
      setRecentEditing(false);
      filters.reset();
    },
  });
  const sourceTasks = useSourceTasks({
    repo,
    setError,
    mounted,
    remoteRef: settings.remoteRef,
    permissionEpoch: settings.permissionEpoch,
    guardRemote: settings.guardRemote,
    checkNetwork: settings.checkNetwork,
    changed,
  });
  // Background check of the shown channels after a category switch.
  const { progress: autoCheck, cancel: cancelAutoCheck } =
    useAutoAvailabilityCheck({
      filterKey:
        tab === "all" &&
        (country !== null || language !== null || group !== null || !!sourceId)
          ? JSON.stringify([sourceId, country, language, group, query])
          : null,
      listComplete: !list.listLoading && list.channelTotal === null,
      channels,
      paused: !!playing,
      remoteAllowed: settings.remoteAllowed && !settings.revokePending,
      mobileWarning: settings.mobileWarning,
      mobileAccepted: settings.mobileAccepted,
      save: async (results) => {
        await repo?.saveCheckResults(results);
      },
      onFinished: changed,
    });
  const controls = useDataControls({
    repo,
    setError,
    settings,
    list,
    playback,
    importer,
    sourceTasks,
    cancelAutoCheck,
    region,
    filters,
    setTab,
    setRecentEditing,
  });

  // Leaving the app stops every network task; playback pauses on its own.
  const { cancelTask, taskRunning } = importer;
  const { stopCheck, stopLanguageLookup } = sourceTasks;
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") return;
      if (taskRunning()) cancelTask();
      stopCheck();
      stopLanguageLookup();
      cancelAutoCheck();
    });
    return () => subscription.remove();
  }, [cancelTask, taskRunning, stopCheck, stopLanguageLookup, cancelAutoCheck]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        // The expanded player owns the key; the docked bar yields to the
        // page's own dialogs first and stops playback only when nothing else
        // is open.
        if (playing && !playerMini) return false;
        if (rename) {
          setRename(null);
          return true;
        }
        if (importer.form) {
          void importer.closeForm();
          return true;
        }
        if (manage) {
          setManage(false);
          return true;
        }
        if (recentEditing) {
          setRecentEditing(false);
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  });

  // Rows are memoized; give them stable handlers that call the latest closures.
  const rowActions = useRef({
    play: (_channel: Channel) => {},
    favorite: (_channel: Channel) => {},
    removeRecent: (_channel: Channel) => {},
  });
  useEffect(() => {
    rowActions.current = {
      play: (channel) => void playback.play(channel),
      favorite: (channel) => void actions.favorite(channel),
      removeRecent: (channel) => {
        setError("");
        void actions
          .removeRecent(channel)
          .catch(() => setError("删除观看记录失败，请重试"));
      },
    };
  });
  const onRowPlay = useCallback(
    (channel: Channel) => rowActions.current.play(channel),
    [],
  );
  const onRowFavorite = useCallback(
    (channel: Channel) => rowActions.current.favorite(channel),
    [],
  );
  const onRowRemoveRecent = useCallback(
    (channel: Channel) => rowActions.current.removeRecent(channel),
    [],
  );

  const changeTab = (key: Tab) => {
    setRecentEditing(false);
    filters.switchTab(
      tab === "settings" ? null : tab,
      key === "settings" ? null : key,
    );
    list.restoreOnNextLoad(key);
    setTab(key);
  };

  if (!repo)
    return (
      <SafeAreaView style={theme.screen}>
        <View style={theme.content}>
          <Heading title="静看" subtitle="只留下你想看的频道" />
          {error ? (
            <>
              <Notice title={error} error />
              <Button
                label="重新打开本地资料"
                onPress={() => {
                  setError("");
                  settings.retryStartup();
                }}
              />
            </>
          ) : (
            <ActivityIndicator color={colors.accent} />
          )}
        </View>
      </SafeAreaView>
    );

  const listTab: ListTab = tab === "settings" ? "all" : tab;
  /** A filter change starts the current tab from its top again. */
  const restartList = () => list.scrollToTopOnNextLoad(tab);
  const listHeaderProps: HeaderProps = {
    tab: listTab,
    sources,
    channelCount: list.channelTotal ?? channels.length,
    search,
    sourceId,
    facets: list.facets,
    facetSelection: { country, language, content: group },
    countryHint:
      region.preference.mode === "manual"
        ? "手动选择"
        : region.result.countryCode && country === null
          ? "当前来源暂无识别地区的国家/地区标注，显示全部"
          : region.result.message,
    autoCheck,
    recentBusy,
    recentEditing,
    recentCount: list.recent.length,
    onToggleRecentEditing: () => {
      if (recentBusy) return;
      if (!recentEditing) {
        list.scrollToTopOnNextLoad("recent");
        filters.clearSearch();
      }
      setRecentEditing(!recentEditing);
    },
    onClearRecent: () => {
      setError("");
      void actions
        .clearRecent()
        .catch(() => setError("清空观看记录失败，请重试"));
    },
    onSearchChange: (text) => {
      restartList();
      filters.setSearch(text);
    },
    onClearSearch: () => {
      restartList();
      filters.clearSearch();
    },
    onSourceChange: (id) => {
      restartList();
      filters.setSource(id);
    },
    onFacetChange: (selection, kind) => {
      restartList();
      Keyboard.dismiss();
      filters.setFacets(selection);
      if (kind === "country") {
        filters.setCountryBypass(null);
        void region.selectManualCountry(selection.country);
      }
    },
  };
  const rows = !list.hasCurrentList || list.listError ? [] : channels;
  const playerExpanded = !!playing && !playerMini;
  return (
    <SafeAreaView
      style={theme.screen}
      edges={["top", "bottom", "left", "right"]}
    >
      {/* The expanded player overlays this content; hide it from TalkBack
          meanwhile. The docked bar leaves the page usable. */}
      <View
        style={appStyles.fill}
        importantForAccessibility={
          playerExpanded ? "no-hide-descendants" : "auto"
        }
        accessibilityElementsHidden={playerExpanded}
      >
        {!!error && !manage && !rename && !importer.form && (
          <View style={appStyles.errorBanner}>
            <Notice title={error} error />
            <Button secondary label="关闭提示" onPress={() => setError("")} />
          </View>
        )}
        {tab === "settings" ? (
          <SettingsScreen
            repo={repo}
            onRestoreBackup={controls.restoreBackup}
            sourceCount={sources.length}
            remoteAllowed={settings.remoteAllowed}
            revokePending={settings.revokePending}
            artworkAllowed={settings.artworkAllowed}
            artworkSaving={settings.artworkSaving}
            artworkRevokePending={settings.artworkRevokePending}
            onRetryArtworkRevoke={() => void settings.changeArtwork(false)}
            onArtworkChange={(value) => void settings.changeArtwork(value)}
            regionConsented={
              region.preference.ipAllowed ||
              region.preference.locationAllowed ||
              region.revokePending
            }
            regionBusy={region.busy}
            onRevokeRegion={() => void region.revokeConsent()}
            mobileWarning={settings.mobileWarning}
            onManageSources={() => {
              setError("");
              setManage(true);
            }}
            onRevoke={() => void controls.revoke()}
            onAllowRemote={() => void settings.guardRemote()}
            onMobileWarningChange={(value) =>
              settings.saveToggle("mobileWarning", value)
            }
            swipeReverse={settings.swipeReverse}
            onSwipeReverseChange={(value) =>
              settings.saveToggle("swipeReverse", value)
            }
            skipUnreachable={settings.skipUnreachable}
            backgroundPlayback={settings.backgroundPlayback}
            onBackgroundPlaybackChange={(value) =>
              settings.saveToggle("backgroundPlayback", value)
            }
            onSkipUnreachableChange={(value) =>
              settings.saveToggle("skipUnreachable", value)
            }
            onClearAll={() => void controls.clearAll()}
          />
        ) : (
          <ChannelListPage
            listRef={list.listRef}
            scrollY={list.scrollY}
            onListScroll={list.onListScroll}
            onScrollBeginDrag={list.scrollRestore.cancel}
            onScrollSettled={list.saveTabOffset}
            listLoading={list.listLoading}
            listError={list.listError}
            headerProps={listHeaderProps}
            rows={rows}
            emptyActions={{
              hasSources: sources.length > 0,
              filtered:
                !!query ||
                !!sourceId ||
                group !== null ||
                language !== null ||
                country !== null,
              onRetry: changed,
              onAddUrl: () => importer.startForm("url"),
              onAddFile: () => importer.startForm("file"),
              onShowAll: () => {
                setRecentEditing(false);
                setTab("all");
                filters.reset();
                void region.selectManualCountry(null);
              },
            }}
            artworkEnabled={settings.artworkEnabled}
            onPlay={onRowPlay}
            onFavorite={onRowFavorite}
            onRemoveRecent={
              tab === "recent" && recentEditing ? onRowRemoveRecent : undefined
            }
            recentBusy={recentBusy}
            reserveMiniBar={!!playing && playerMini}
          />
        )}
        <View
          onLayout={(event) => setTabsHeight(event.nativeEvent.layout.height)}
        >
          <BottomTabs tab={tab} onChange={changeTab} />
        </View>
      </View>
      <SourceDialogs
        repo={repo}
        sources={sources}
        managing={manage}
        setManaging={setManage}
        renaming={rename}
        setRenaming={setRename}
        error={error}
        setError={setError}
        importer={importer}
        sourceTasks={sourceTasks}
        onRemoveSource={(source) => void controls.removeSource(source)}
        changed={changed}
      />
      {playing && (
        <HomePlayer
          playing={playing}
          playback={playback}
          settings={settings}
          tabsHeight={tabsHeight}
          freshRows={[...playback.playQueue, ...channels, ...list.recent]}
          error={error}
          onDismissError={() => setError("")}
          onFavorite={(channel) => void actions.favorite(channel)}
          onStarted={actions.recordStarted}
          sheet={{
            filters: listHeaderProps,
            onTabChange: changeTab,
            channels: rows,
            rangeKey: list.hasCurrentList
              ? JSON.stringify([
                  tab,
                  sourceId,
                  group,
                  language,
                  countryKey,
                  countryBypassed,
                  query,
                ])
              : null,
            loading: list.listLoading,
            onLocate: () => {
              list.scrollToTopOnNextLoad("all");
              setRecentEditing(false);
              if (tab !== "all") changeTab("all");
              filters.reset();
              filters.setCountryBypass(countryKey);
            },
          }}
        />
      )}
    </SafeAreaView>
  );
}

const appStyles = StyleSheet.create({
  fill: { flex: 1 },
  errorBanner: { padding: 12 },
});
