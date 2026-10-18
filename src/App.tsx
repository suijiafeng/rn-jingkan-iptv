import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  AppState,
  BackHandler,
  FlatList,
  View,
  Keyboard,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as Network from "expo-network";
import { openRepository, Repository } from "./data/repository";
import { Channel, Source, SourceKind } from "./domain/types";
import {
  buildFacetOptions,
  contentOptions,
  EMPTY_FACET_OPTIONS,
  type ChannelFacetOptions,
} from "./domain/channelFacets";
import {
  effectiveCountry,
  useRegionPreference,
} from "./features/region/useRegionPreference";
import { MAX_MIB, parseM3U } from "./domain/m3u";
import {
  downloadPlaylist,
  ImportIOError,
  readPickedFile,
} from "./data/importIO";
import { Button, Heading, Notice } from "./components/ui";
import {
  CHANNEL_ROW_GAP,
  ChannelRow,
  channelRowHeight,
  channelRowLayout,
} from "./components/ChannelRow";
import { colors, styles } from "./theme";
import { PlayerScreen } from "./features/player/PlayerScreen";
import {
  isOffline,
  mightUseMobileData,
} from "./features/player/playbackController";
import { confirm, RISK } from "./features/common/confirm";
import { initialForm, SourceFormState } from "./features/source/form";
import { SourceFormModal } from "./features/source/SourceFormModal";
import {
  CheckProgress,
  CheckSummary,
  RenameSourceModal,
  SourceManagerModal,
} from "./features/source/SourceManagerModal";
import { checkChannels } from "./features/source/availability";
import { useAutoAvailabilityCheck } from "./features/channel/useAutoAvailabilityCheck";
import { useChannelFilters } from "./features/channel/useChannelFilters";
import { lookupIptvOrgLanguages } from "./features/source/iptvOrgLanguages";
import { isIptvOrgId } from "./domain/channelFacets";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { createScrollRestore } from "./features/channel/scrollRestore";
import {
  BottomTabs,
  ChannelListEmpty,
  ChannelFilterBar,
  ChannelListTitle,
  type HeaderProps,
  ListTab,
  Tab,
} from "./features/channel/ChannelListParts";

// The empty state is a sentinel row so it renders below the header overlay.
const EMPTY_ROW = { kind: "empty" } as const;
/** Bar height plus its margins, reserved under the list while docked. */
const MINI_BAR_SPACE = 88;
type ListItem = Channel | typeof EMPTY_ROW;
// A screenful is shown first; the rest of a 10k-row list follows in a second
// read so switching tabs or filters does not wait for the whole table.
const FIRST_PAGE = 40;
const ListSeparator = () => <View style={{ height: CHANNEL_ROW_GAP }} />;
const listKey = (item: ListItem) =>
  item === EMPTY_ROW ? "__empty__" : (item as Channel).id;

export default function App() {
  // Channel rows grow with the font scale; see channelRowHeight.
  const { fontScale } = useWindowDimensions();
  const [repo, setRepo] = useState<Repository | null>(null),
    [startupAttempt, setStartupAttempt] = useState(0),
    [loadedRequest, setLoadedRequest] = useState<{
      tab: Tab;
      sourceId: string;
      group: string | null;
      language: string | null;
      countryKey: string;
      countryBypassed: boolean;
      query: string;
    } | null>(null),
    [listError, setListError] = useState(""),
    [error, setError] = useState(""),
    [sources, setSources] = useState<Source[]>([]),
    [channels, setChannels] = useState<Channel[]>([]),
    // Matching rows while the remainder of a paged list is still loading.
    [channelTotal, setChannelTotal] = useState<number | null>(null),
    [recent, setRecent] = useState<Channel[]>([]);
  const [tab, setTab] = useState<Tab>("all"),
    [facets, setFacets] = useState<ChannelFacetOptions>(EMPTY_FACET_OPTIONS);
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
  const country = countryBypassed
    ? null
    : effectiveCountry(region.preference, region.result, facets.countries);
  const [remoteAllowed, setRemoteAllowed] = useState(false),
    [revokePending, setRevokePending] = useState(false),
    [mobileWarning, setMobileWarning] = useState(true),
    [swipeReverse, setSwipeReverse] = useState(false),
    [skipUnreachable, setSkipUnreachable] = useState(true),
    [artworkAllowed, setArtworkAllowed] = useState(false),
    [artworkSaving, setArtworkSaving] = useState(false),
    [artworkRevokePending, setArtworkRevokePending] = useState(false),
    // One confirmation covers this metered connection until Wi-Fi returns.
    [mobileAccepted, setMobileAccepted] = useState(false),
    [form, setForm] = useState<SourceFormState | null>(null),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(""),
    [manage, setManage] = useState(false),
    [rename, setRename] = useState<Source | null>(null),
    [renameText, setRenameText] = useState("");
  // Drives the header overlay from the list's native scroll events.
  const [scrollY] = useState(() => new Animated.Value(0));
  const [headerHeight, setHeaderHeight] = useState(0),
    [titleSpace, setTitleSpace] = useState(0);
  const [playing, setPlaying] = useState<Channel | null>(null),
    // Docked bar over the channel page; the stream keeps playing (foreground
    // only, leaving the app still pauses). Height of the tab bar it sits above.
    [playerMini, setPlayerMini] = useState(false),
    [tabsHeight, setTabsHeight] = useState(0),
    [playingSources, setPlayingSources] = useState<Channel[]>([]),
    // For "回到上一个频道": the channel watched before the current one.
    [previousChannel, setPreviousChannel] = useState<Channel | null>(null),
    [playQueue, setPlayQueue] = useState<Channel[]>([]),
    [revision, setRevision] = useState(0);
  const [recentBusy, setRecentBusy] = useState(false),
    [recentEditing, setRecentEditing] = useState(false);
  const recentMutation = useRef(false);
  const [check, setCheck] = useState<CheckProgress | null>(null),
    [checkSummaries, setCheckSummaries] = useState<
      Record<string, CheckSummary>
    >({}),
    // iptv-org language lookup (user-triggered, one download).
    [languageLookup, setLanguageLookup] = useState<string | null>(null),
    [languageMessages, setLanguageMessages] = useState<Record<string, string>>(
      {},
    );
  const controller = useRef<AbortController | null>(null),
    checkController = useRef<AbortController | null>(null),
    languageController = useRef<AbortController | null>(null),
    generation = useRef(0),
    checkGeneration = useRef(0),
    playGeneration = useRef(0),
    lastWatched = useRef<Channel | null>(null),
    saving = useRef(false),
    loadGeneration = useRef(0),
    mounted = useRef(true),
    remoteRef = useRef(false),
    permissionEpoch = useRef(0);
  const artworkMutation = useRef(false);
  // Each bottom tab keeps its own scroll position across tab switches.
  const listRef = useRef<FlatList<ListItem>>(null),
    tabOffsets = useRef<Partial<Record<Tab, number>>>({}),
    restoreTab = useRef<Tab | null>(null),
    // Resolves to the complete current list (the play queue) once loaded.
    fullList = useRef<Promise<Channel[]>>(Promise.resolve([])),
    listSettled = useRef(true),
    [scrollRestore] = useState(createScrollRestore);
  // Re-sent each frame until the list reports the offset (see scrollRestore).
  const restoreOffset = useCallback(
    (target: number) => {
      const send = (offset: number | null) => {
        if (offset === null) return;
        listRef.current?.scrollToOffset({ offset, animated: false });
        if (scrollRestore.pending())
          requestAnimationFrame(() => send(scrollRestore.retry()));
      };
      send(scrollRestore.request(target));
    },
    [scrollRestore],
  );
  // Read by async handlers that must act on the tab shown when they finish.
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
  const changed = useCallback(() => setRevision((v) => v + 1), []);
  // Rows are memoized; give them stable handlers that call the latest closures.
  const rowActions = useRef({
    play: (_c: Channel) => {},
    favorite: (_c: Channel) => {},
    removeRecent: (_c: Channel) => {},
  });
  const onRowPlay = useCallback((c: Channel) => rowActions.current.play(c), []);
  const onRowFavorite = useCallback(
    (c: Channel) => rowActions.current.favorite(c),
    [],
  );
  const onRowRemoveRecent = useCallback(
    (c: Channel) => rowActions.current.removeRecent(c),
    [],
  );
  const loadRequest = useMemo(
    () => ({
      repo,
      tab,
      sourceId,
      group,
      language,
      countryKey,
      countryBypassed,
      query,
      revision,
    }),
    [
      repo,
      tab,
      sourceId,
      group,
      language,
      countryKey,
      countryBypassed,
      query,
      revision,
    ],
  );
  const listLoading = loadedRequest !== loadRequest;

  // Native-driven: moves the header overlay without a JS listener.
  const onListScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        // Only the restore watches the offset here; saving waits for a drag.
        listener: (e: NativeSyntheticEvent<NativeScrollEvent>) =>
          scrollRestore.scrolled(e.nativeEvent.contentOffset.y),
      }),
    [scrollY, scrollRestore],
  );
  const hasCurrentList =
    loadedRequest?.tab === tab &&
    loadedRequest.sourceId === sourceId &&
    loadedRequest.group === group &&
    loadedRequest.language === language &&
    loadedRequest.countryKey === countryKey &&
    loadedRequest.countryBypassed === countryBypassed &&
    loadedRequest.query === query;
  // Background check of the shown channels after a category switch.
  const { progress: autoCheck, cancel: cancelAutoCheck } =
    useAutoAvailabilityCheck({
      filterKey:
        tab === "all" &&
        (country !== null || language !== null || group !== null || !!sourceId)
          ? JSON.stringify([sourceId, country, language, group, query])
          : null,
      listComplete: !listLoading && channelTotal === null,
      channels,
      paused: !!playing,
      remoteAllowed: remoteAllowed && !revokePending,
      mobileWarning,
      mobileAccepted,
      save: async (results) => {
        await repo?.saveCheckResults(results);
      },
      onFinished: changed,
    });
  const cancelTask = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
  }, [setBusy]);
  const stopCheck = useCallback(() => {
    checkController.current?.abort();
    checkController.current = null;
    setCheck(null);
  }, [setCheck]);
  const stopLanguageLookup = useCallback(() => {
    languageController.current?.abort();
    languageController.current = null;
    setLanguageLookup(null);
  }, [setLanguageLookup]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    openRepository()
      .then(async (r) => {
        const allowed = await r.getSetting("remoteAllowed", false);
        const warning = await r.getSetting("mobileWarning", true);
        const reverse = await r.getSetting("swipeReverse", false);
        const skipDead = await r.getSetting("skipUnreachable", true);
        const artwork = await r.getSetting("artworkAllowed", false);
        const favorites = await r.listChannels({ mode: "favorites" });
        if (active) {
          remoteRef.current = allowed;
          setRemoteAllowed(allowed);
          setMobileWarning(warning);
          setSwipeReverse(reverse);
          setSkipUnreachable(skipDead);
          setArtworkAllowed(artwork);
          setTab(favorites.length ? "favorites" : "all");
          setRepo(r);
        }
      })
      .catch(() => {
        if (active) setError("本地资料未能打开。可以重试，不会自动清空数据。");
      });
    return () => {
      active = false;
      mounted.current = false;
      controller.current?.abort();
      checkController.current?.abort();
      languageController.current?.abort();
    };
  }, [startupAttempt]);
  useEffect(() => {
    if (!repo || !region.ready) return;
    let active = true;
    const id = ++loadGeneration.current;
    const current = () => active && id === loadGeneration.current;
    scrollRestore.cancel();
    const restoring = restoreTab.current === tab;
    // Restoring a scroll offset needs every row laid out, so read it whole.
    const paged = !(restoring && (tabOffsets.current[tab] ?? 0) > 0);
    listSettled.current = false;
    let settle!: (rows: Channel[]) => void;
    const settled = new Promise<Channel[]>((resolve) => (settle = resolve));
    fullList.current = settled;
    const load = async () => {
      const facetRows =
        tab === "all" ? await repo.listFacetRows(sourceId || undefined) : [];
      if (!current()) return;
      const baseFacets =
        tab === "all" ? buildFacetOptions(facetRows) : EMPTY_FACET_OPTIONS;
      const selectedCountry = countryBypassed
        ? null
        : effectiveCountry(
            region.preference,
            region.result,
            baseFacets.countries,
          );
      const nextFacets =
        tab === "all"
          ? {
              ...baseFacets,
              contents: contentOptions(facetRows, {
                country: selectedCountry,
                language,
                content: group,
              }),
            }
          : EMPTY_FACET_OPTIONS;
      const filter = {
        mode: tab === "settings" ? ("all" as const) : tab,
        sourceId: tab === "all" ? sourceId || undefined : undefined,
        groupName: tab === "all" ? (group ?? undefined) : undefined,
        country: tab === "all" ? (selectedCountry ?? undefined) : undefined,
        language: tab === "all" ? (language ?? undefined) : undefined,
        search: query,
      };
      const [s, c, r] = await Promise.all([
        repo.listSources(),
        repo.listChannels(paged ? { ...filter, limit: FIRST_PAGE } : filter),
        repo.listChannels({ mode: "recent" }),
      ]);
      if (!current()) return;
      const partial = paged && c.length === FIRST_PAGE;
      const total = partial ? await repo.countChannels(filter) : null;
      if (!current()) return;
      setListError("");
      setSources(s);
      setChannels(c);
      setChannelTotal(total);
      setFacets(nextFacets);
      setRecent(r);
      setLoadedRequest(loadRequest);
      if (restoring) {
        restoreTab.current = null;
        const offset = tabOffsets.current[tab] ?? 0;
        requestAnimationFrame(() => {
          if (current()) restoreOffset(offset);
        });
      }
      if (!partial) return c;
      const rest = await repo.listChannels({
        ...filter,
        offset: FIRST_PAGE,
      });
      if (!current()) return c;
      const all = [...c, ...rest];
      setChannels((shown) =>
        // Keep local patches (favorite, forgotten recent) made meanwhile.
        shown.length === c.length ? [...shown, ...rest] : all,
      );
      setChannelTotal(null);
      return all;
    };
    void load()
      .catch(() => {
        if (!current()) return;
        setListError("读取资料失败，你的频道与收藏仍保存在本机。");
        setLoadedRequest(loadRequest);
      })
      .then((rows) => {
        if (current()) listSettled.current = true;
        settle(rows ?? []);
      });
    return () => {
      active = false;
    };
  }, [
    repo,
    tab,
    sourceId,
    group,
    language,
    countryBypassed,
    query,
    revision,
    loadRequest,
    region.ready,
    region.preference,
    region.result,
    scrollRestore,
    restoreOffset,
  ]);
  useEffect(() => {
    const sub = Network.addNetworkStateListener((net) => {
      if (!isOffline(net) && !mightUseMobileData(net)) setMobileAccepted(false);
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") return;
      if (controller.current) cancelTask();
      stopCheck();
      stopLanguageLookup();
      cancelAutoCheck();
    });
    return () => sub.remove();
  }, [cancelTask, stopCheck, stopLanguageLookup, cancelAutoCheck]);
  const guardRemote = async (signal?: AbortSignal) => {
    if (signal?.aborted) return false;
    if (remoteRef.current) return true;
    if (revokePending) {
      setError("联网许可撤销尚未保存，请先在设置中重试保存撤销。");
      return false;
    }
    const epoch = permissionEpoch.current;
    const ok = await confirm("允许访问节目来源？", RISK, "了解风险并允许");
    if (
      !ok ||
      !repo ||
      signal?.aborted ||
      epoch !== permissionEpoch.current ||
      !mounted.current
    )
      return false;
    try {
      await repo.setSetting("remoteAllowed", true);
    } catch {
      setError("无法保存网络许可，请重试");
      return false;
    }
    if (epoch !== permissionEpoch.current || !mounted.current) return false;
    remoteRef.current = true;
    setRemoteAllowed(true);
    return true;
  };
  const checkNetwork = async (signal?: AbortSignal) => {
    const net = await Network.getNetworkStateAsync();
    if (signal?.aborted) return false;
    if (isOffline(net))
      throw new ImportIOError("当前没有可用网络，请连接后重试");
    // Same rule as playback: VPN/unknown transports may be metered.
    if (mobileWarning && !mobileAccepted && mightUseMobileData(net)) {
      const ok = await confirm(
        "可能使用移动数据？",
        "下载节目单或播放直播会消耗流量。确认后，在连回 Wi-Fi 之前不再询问。",
        "继续",
      );
      if (signal?.aborted) return false;
      if (ok) setMobileAccepted(true);
      return ok;
    }
    return true;
  };
  const closeForm = async () => {
    if (saving.current) return;
    if (
      form &&
      (form.name || form.url || form.content || busy) &&
      !(await confirm(
        "放弃这次导入？",
        "尚未保存的输入与预览会被丢弃，已有频道不受影响。",
        "放弃",
      ))
    )
      return;
    cancelTask();
    if (form?.refresh) repo?.cancelRefresh(form.refresh.sourceId);
    setForm(null);
    setFormError("");
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      // The expanded player owns the key; the docked bar yields to the page's
      // own dialogs first and stops playback only when nothing else is open.
      if (playing && !playerMini) return false;
      if (rename) {
        setRename(null);
        return true;
      }
      if (form) {
        void closeForm();
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
    });
    return () => sub.remove();
  });
  const startForm = (kind: SourceKind) => {
    setError("");
    setForm(initialForm(kind));
    setFormError("");
  };
  const updateForm = (patch: Partial<SourceFormState>) =>
    setForm((f) => (f ? { ...f, ...patch, preview: null } : f));
  const chooseFile = async () => {
    if (busy) return;
    const task = ++generation.current;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "audio/x-mpegurl",
          "application/vnd.apple.mpegurl",
          "text/plain",
          "application/octet-stream",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || task !== generation.current) return;
      const asset = result.assets[0];
      const c = new AbortController();
      controller.current = c;
      setBusy(true);
      const content = await readPickedFile(asset.uri, c.signal);
      if (task === generation.current)
        updateForm({ content, fileName: asset.name, kind: "file" });
    } catch {
      if (task === generation.current)
        setFormError(
          `文件读取失败或超过 ${MAX_MIB} MiB，请选择有效 UTF-8 M3U 文件。`,
        );
    } finally {
      if (task === generation.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  };
  const preview = async () => {
    if (!form || busy) return;
    const snapshot = form;
    const task = ++generation.current;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError("");
    setFormError("");
    try {
      let text = snapshot.content,
        baseUrl: string | undefined;
      if (snapshot.kind === "url") {
        if (!(await guardRemote()) || task !== generation.current) return;
        if (!(await checkNetwork()) || task !== generation.current) return;
        const data = await downloadPlaylist(
          snapshot.url.trim(),
          c.signal,
          remoteRef.current,
        );
        text = data.text;
        baseUrl = data.url;
      } else if (!text) throw new ImportIOError("请先选择文件");
      const parsed = await parseM3U(text, { baseUrl, signal: c.signal });
      if (task !== generation.current || c.signal.aborted) return;
      setForm((f) => (f ? { ...f, preview: parsed } : f));
    } catch (e) {
      if (task === generation.current) {
        setFormError(
          e instanceof Error ? e.message : "无法解析节目单，请检查后重试",
        );
        if (snapshot.refresh && !c.signal.aborted)
          void repo
            ?.setSourceError(
              snapshot.refresh.sourceId,
              "refresh_failed",
              snapshot.refresh.revision,
            )
            .then(changed)
            .catch(() => {});
      }
    } finally {
      if (task === generation.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  };
  const reconcilePlayingSources = async (current = playing) => {
    if (!repo || !current) return;
    const fresh = await repo.getChannel(current.id);
    const groupKey =
      fresh?.active && fresh.groupKey
        ? fresh.groupKey
        : (current.groupKey ?? current.id);
    const alternatives = await repo.listChannelSources(groupKey);
    if (!mounted.current) return;
    ++playGeneration.current;
    setPlayingSources(alternatives);
    if (!alternatives.length) {
      setPlaying(null);
      return;
    }
    setPlaying(
      alternatives.find((source) => source.id === current.id) ??
        alternatives[0],
    );
  };
  const save = async () => {
    if (!repo || !form?.preview || saving.current) return;
    saving.current = true;
    setBusy(true);
    const f = form;
    try {
      if (f.refresh) {
        await repo.refreshSource(
          f.refresh.sourceId,
          f.refresh.revision,
          f.preview!,
          {
            generation: f.refresh.generation,
            content: f.kind === "file" ? f.content : undefined,
            location: f.kind === "file" ? f.fileName : undefined,
          },
        );
        try {
          await reconcilePlayingSources();
        } catch {
          if (mounted.current)
            setError(
              "节目单已保存，但播放器来源列表更新失败，请重新打开频道。",
            );
        }
      } else {
        const name =
          f.name.trim() ||
          (f.kind === "file" ? f.fileName : new URL(f.url).hostname);
        await repo.importSource({
          name,
          kind: f.kind,
          location: f.kind === "file" ? f.fileName : f.url.trim(),
          preview: f.preview!,
          content: f.kind === "file" ? f.content : undefined,
        });
      }
      setForm(null);
      setTab("all");
      setRecentEditing(false);
      filters.reset();
      changed();
    } catch {
      setFormError("保存失败，旧数据未改变。请重试；刷新冲突时请重新刷新。");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const refresh = async (s: Source) => {
    if (!repo || busy) return;
    setError("");
    try {
      const token = await repo.beginRefresh(s.id);
      const content =
        s.kind === "file" ? (await repo.getSourceContent(s.id)) || "" : "";
      setForm({
        ...initialForm(s.kind),
        name: s.name,
        url: s.kind === "url" ? s.location : "",
        fileName: s.kind === "file" ? s.location : "",
        content,
        refresh: token,
      });
      setFormError("");
    } catch {
      setError("这个来源正在刷新或已经被删除");
    }
  };
  /** Manual, user-started availability sweep of one source's channels. */
  /**
   * Fills missing languages for this source's iptv-org formatted channels
   * from the iptv-org database. Same gates as any other remote request.
   */
  const runLanguageLookup = async (s: Source) => {
    if (!repo || languageController.current) return;
    const c = new AbortController();
    languageController.current = c;
    const epoch = permissionEpoch.current;
    const current = () =>
      mounted.current &&
      languageController.current === c &&
      !c.signal.aborted &&
      epoch === permissionEpoch.current;
    const say = (message: string) =>
      setLanguageMessages((all) => ({ ...all, [s.id]: message }));
    setLanguageLookup(s.id);
    try {
      if (!(await guardRemote(c.signal)) || !current()) return;
      if (!(await checkNetwork(c.signal)) || !current()) return;
      const targets = (
        await repo.listChannels({ sourceId: s.id, includeVariants: true })
      ).filter(
        (channel) => isIptvOrgId(channel.tvgId) && !channel.languages?.length,
      );
      if (!current()) return;
      if (!targets.length) {
        say("没有需要补全的频道");
        return;
      }
      const found = await lookupIptvOrgLanguages(
        new Set(targets.map((channel) => channel.tvgId!)),
        c.signal,
      );
      if (!current()) return;
      const changedCount = await repo.saveLookedUpLanguages(
        targets.flatMap((channel) => {
          const languages = found.get(channel.tvgId!);
          return languages
            ? [{ channelId: channel.id, tvgId: channel.tvgId!, languages }]
            : [];
        }),
      );
      say(`已补全 ${changedCount} 个频道的语言`);
      changed();
    } catch (e) {
      if (mounted.current && epoch === permissionEpoch.current)
        say(
          e instanceof Error && e.message
            ? e.message
            : "补全语言失败，请稍后重试",
        );
    } finally {
      if (languageController.current === c) {
        languageController.current = null;
        setLanguageLookup(null);
      }
    }
  };
  const runCheck = async (s: Source) => {
    if (!repo || checkController.current || AppState.currentState !== "active")
      return;
    const c = new AbortController();
    checkController.current = c;
    const task = ++checkGeneration.current;
    const epoch = permissionEpoch.current;
    const current = () => mounted.current && task === checkGeneration.current;
    const allowed = () =>
      current() &&
      checkController.current === c &&
      !c.signal.aborted &&
      remoteRef.current &&
      epoch === permissionEpoch.current &&
      AppState.currentState === "active";
    let started = false;
    let savingResults = false;
    setError("");
    setCheck({ sourceId: s.id, done: 0, total: null });
    try {
      if (!(await guardRemote(c.signal)) || !allowed()) return;
      if (!(await checkNetwork(c.signal)) || !allowed()) return;
      const targets = await repo.listChannels({
        sourceId: s.id,
        includeVariants: true,
      });
      if (!allowed()) return;
      setCheck({ sourceId: s.id, done: 0, total: targets.length });
      started = true;
      const results = await checkChannels(targets, {
        signal: c.signal,
        onProgress: (done, total) => {
          if (allowed()) setCheck({ sourceId: s.id, done, total });
        },
      });
      // Manual stop may save finished results, but a newer sweep or revocation
      // makes this task obsolete and must not publish its results.
      if (!current() || epoch !== permissionEpoch.current || !remoteRef.current)
        return;
      savingResults = true;
      await repo.saveCheckResults(results);
      if (!current() || epoch !== permissionEpoch.current || !remoteRef.current)
        return;
      const ok = results.filter((r) => r.ok).length;
      setCheckSummaries((all) => ({
        ...all,
        [s.id]: {
          ok,
          unreachable: results.length - ok,
          stopped: c.signal.aborted,
        },
      }));
      changed();
    } catch (e) {
      if (
        current() &&
        (savingResults || !c.signal.aborted) &&
        epoch === permissionEpoch.current
      )
        setError(
          started
            ? "检测结果未能保存，请重试"
            : e instanceof ImportIOError
              ? e.message
              : "无法开始检测，请检查网络后重试",
        );
    } finally {
      if (checkController.current === c) {
        checkController.current = null;
        setCheck(null);
      }
    }
  };
  const favorite = async (c: Channel) => {
    if (!repo) return;
    try {
      const fav = await repo.toggleFavorite(c.id);
      const patch = (x: Channel) =>
        (x.groupKey ?? x.id) === (c.groupKey ?? c.id)
          ? { ...x, favorite: fav }
          : x;
      setPlaying((p) => (p ? patch(p) : p));
      setPlayingSources((items) => items.map(patch));
      setPlayQueue((q) => q.map(patch));
      setRecent((r) => r.map(patch));
      setChannels((list) => list.map(patch));
      // The patch is enough for lists that keep the row. Re-read only the
      // favorites view (membership changed) or a list whose read may predate
      // this write; never filter using the initiating tab.
      if (tabRef.current === "favorites" || !listSettled.current) changed();
      else
        void repo
          .listSources()
          .then((s) => {
            if (mounted.current) setSources(s);
          })
          .catch(() => {
            if (mounted.current)
              setError("收藏已保存，但来源统计读取失败，请稍后重试。");
          });
    } catch {
      setError("收藏未能保存，请重试");
    }
  };
  const forgetRecent = (channelId?: string) => {
    const patch = (channel: Channel) =>
      !channelId || channel.id === channelId
        ? { ...channel, lastPlayedAt: null }
        : channel;
    setRecent((items) =>
      channelId ? items.filter((item) => item.id !== channelId) : [],
    );
    setChannels((items) => items.map(patch));
    setPlayQueue((items) => items.map(patch));
    setPlaying((current) => (current ? patch(current) : current));
    changed();
  };
  const removeRecent = async (channel: Channel) => {
    if (!repo || recentMutation.current) return;
    recentMutation.current = true;
    setRecentBusy(true);
    try {
      await repo.removeRecent(channel.id);
      if (mounted.current) forgetRecent(channel.id);
    } finally {
      recentMutation.current = false;
      if (mounted.current) setRecentBusy(false);
    }
  };
  const clearRecent = async () => {
    if (!repo || recentMutation.current) return;
    recentMutation.current = true;
    setRecentBusy(true);
    try {
      if (
        !(await confirm(
          "清空最近观看？",
          "只删除观看记录，收藏与频道保留。",
          "清空",
        ))
      )
        return;
      await repo.clearRecent();
      if (mounted.current) {
        forgetRecent();
        setRecentEditing(false);
      }
    } finally {
      recentMutation.current = false;
      if (mounted.current) setRecentBusy(false);
    }
  };
  const play = async (c: Channel, queueFrom?: Channel[]) => {
    if (!repo || !c.active) return;
    const task = ++playGeneration.current;
    const epoch = permissionEpoch.current;
    // A tap during progressive loading still queues the whole list.
    const whole = listSettled.current ? null : fullList.current;
    try {
      if (!(await guardRemote()) || epoch !== permissionEpoch.current) return;
      const queue = queueFrom ?? (whole ? await whole : channels);
      // Read only this channel so the player opens at once; loading 10k+
      // catalog rows first took ~5 s on the emulator.
      const fresh = await repo.getChannel(c.id);
      if (
        !mounted.current ||
        task !== playGeneration.current ||
        epoch !== permissionEpoch.current
      )
        return;
      const representative = fresh?.active ? fresh : null;
      if (!representative) {
        setError("频道已不可用，请重新读取频道后重试");
        return;
      }
      const alternatives = await repo.listChannelSources(
        representative.groupKey ?? representative.id,
      );
      if (
        !mounted.current ||
        task !== playGeneration.current ||
        epoch !== permissionEpoch.current
      )
        return;
      setPlayQueue(queue.filter((x) => x.active));
      const playable = alternatives[0] ?? representative;
      setPlayingSources(alternatives.length ? alternatives : [representative]);
      const from = playing ?? lastWatched.current;
      if (from && from.id !== playable.id) setPreviousChannel(from);
      setPlaying(playable);
      // A pick from the page (or the bar's own list) opens the full player.
      setPlayerMini(false);
    } catch {
      if (
        mounted.current &&
        task === playGeneration.current &&
        epoch === permissionEpoch.current
      )
        setError("无法读取播放频道，请重试");
    }
  };
  const remove = async (s: Source) => {
    if (
      !repo ||
      !(await confirm(
        `删除“${s.name}”？`,
        `会移除 ${s.channelCount} 个频道及 ${s.favoriteCount} 个收藏与相关观看记录。应用内无法撤销。`,
        "删除",
      ))
    )
      return;
    cancelTask();
    if (check?.sourceId === s.id) stopCheck();
    if (languageLookup === s.id) stopLanguageLookup();
    if (previousChannel?.sourceId === s.id) setPreviousChannel(null);
    if (lastWatched.current?.sourceId === s.id) lastWatched.current = null;
    repo.cancelRefresh(s.id);
    setError("");
    try {
      await repo.deleteSource(s.id);
      try {
        await reconcilePlayingSources();
      } catch {
        if (mounted.current) {
          setPlaying(null);
          setPlayingSources([]);
          setError("来源已删除；播放器来源列表更新失败，已停止当前播放。");
        }
      }
      filters.forgetSource(s.id);
      changed();
    } catch {
      setError("删除未完成，请重试");
    }
  };
  const revoke = async () => {
    if (!repo) return;
    if (
      !revokePending &&
      !(await confirm(
        "撤销联网许可？",
        "将停止播放并取消导入。下次联网前会再次说明风险。",
        "撤销",
      ))
    )
      return;
    permissionEpoch.current++;
    setError("");
    remoteRef.current = false;
    setRemoteAllowed(false);
    setRevokePending(true);
    setPlaying(null);
    setPlayingSources([]);
    cancelTask();
    stopCheck();
    stopLanguageLookup();
    cancelAutoCheck();
    region.cancel();
    try {
      await repo.setSetting("remoteAllowed", false);
      setRevokePending(false);
    } catch {
      setError("许可已在本次运行中撤销，但未能保存。请重试撤销。");
    }
  };
  const changeArtwork = async (enabled: boolean) => {
    if (!repo || artworkMutation.current) return;
    artworkMutation.current = true;
    setArtworkSaving(true);
    const epoch = permissionEpoch.current;
    try {
      if (enabled) {
        if (!remoteRef.current || revokePending || artworkRevokePending) return;
        const accepted = await confirm(
          "显示频道台标？",
          "将加载节目单提供的 HTTPS 台标，图片服务器会看到你的访问 IP，可能消耗移动数据。仅用于显示台标，不提供节目封面；缺图或失败时显示频道首字。原生图片请求可能跟随服务端重定向，无法保证后续连接仍是 HTTPS。可随时在设置中关闭。",
          "允许显示",
        );
        if (
          !accepted ||
          epoch !== permissionEpoch.current ||
          !remoteRef.current ||
          !mounted.current
        )
          return;
      } else {
        // Stop visible requests immediately, even if persisting revocation fails.
        setArtworkAllowed(false);
        setArtworkRevokePending(true);
      }
      await repo.setSetting("artworkAllowed", enabled);
      if (mounted.current && epoch === permissionEpoch.current) {
        setArtworkAllowed(enabled);
        setArtworkRevokePending(false);
      }
    } catch {
      if (mounted.current)
        setError(
          enabled
            ? "台标许可未能保存，请重试"
            : "台标已关闭，但设置未能保存，重启前请重试关闭",
        );
    } finally {
      artworkMutation.current = false;
      if (mounted.current) setArtworkSaving(false);
    }
  };
  const clearAll = async () => {
    if (
      !repo ||
      !(await confirm(
        "清空全部本地资料？",
        "节目单、收藏、观看记录与设置都会删除，无法在应用内恢复。你原来的文件不受影响。",
        "全部清空",
      ))
    )
      return;
    permissionEpoch.current++;
    remoteRef.current = false;
    setRemoteAllowed(false);
    setRevokePending(true);
    setPlaying(null);
    setPlayingSources([]);
    cancelTask();
    stopCheck();
    stopLanguageLookup();
    cancelAutoCheck();
    region.cancel();
    try {
      await repo.clearAll();
      setRevokePending(false);
      setMobileWarning(true);
      setMobileAccepted(false);
      setSwipeReverse(false);
      setSkipUnreachable(true);
      setArtworkAllowed(false);
      setArtworkRevokePending(false);
      region.reset();
      setPreviousChannel(null);
      lastWatched.current = null;
      setCheckSummaries({});
      filters.forgetSaved();
      filters.reset();
      filters.setCountryBypass(null);
      tabOffsets.current = {};
      setTab("all");
      setRecentEditing(false);
      changed();
    } catch {
      setError("清理未完成，请重试");
    }
  };
  const changeTab = (key: Tab) => {
    setRecentEditing(false);
    filters.switchTab(
      tab === "settings" ? null : tab,
      key === "settings" ? null : key,
    );
    restoreTab.current = key;
    setTab(key);
  };
  useEffect(() => {
    rowActions.current = {
      play: (c) => void play(c),
      favorite: (c) => void favorite(c),
      removeRecent: (c) => {
        setError("");
        void removeRecent(c).catch(() => setError("删除观看记录失败，请重试"));
      },
    };
  });
  if (!repo)
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <Heading title="静看" subtitle="只留下你想看的频道" />
          {error ? (
            <>
              <Notice title={error} error />
              <Button
                label="重新打开本地资料"
                onPress={() => {
                  setError("");
                  setStartupAttempt((value) => value + 1);
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
  const listHeaderProps: HeaderProps = {
    tab: listTab,
    sources,
    channelCount: channelTotal ?? channels.length,
    search,
    sourceId,
    facets,
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
    recentCount: recent.length,
    onToggleRecentEditing: () => {
      if (recentBusy) return;
      if (!recentEditing) {
        tabOffsets.current.recent = 0;
        restoreTab.current = "recent";
        filters.clearSearch();
      }
      setRecentEditing((value) => !value);
    },
    onClearRecent: () => {
      setError("");
      void clearRecent().catch(() => setError("清空观看记录失败，请重试"));
    },
    onSearchChange: (text) => {
      tabOffsets.current[tab] = 0;
      restoreTab.current = tab;
      filters.setSearch(text);
    },
    onClearSearch: () => {
      tabOffsets.current[tab] = 0;
      restoreTab.current = tab;
      filters.clearSearch();
    },
    onSourceChange: (id) => {
      tabOffsets.current[tab] = 0;
      restoreTab.current = tab;
      filters.setSource(id);
    },
    onFacetChange: (selection, kind) => {
      tabOffsets.current[tab] = 0;
      restoreTab.current = tab;
      Keyboard.dismiss();
      filters.setFacets(selection);
      if (kind === "country") {
        filters.setCountryBypass(null);
        void region.selectManualCountry(selection.country);
      }
    },
  };
  const rows = !hasCurrentList || listError ? [] : channels;
  const listData: ListItem[] = rows.length ? rows : [EMPTY_ROW];
  // Pinned filters: the title + filter bar sit in an overlay above the list
  // (so taps land on them, not on rows scrolled underneath, which is what an
  // in-list stickyHeaderIndices row did on Android) and slide up by the title
  // height as the list scrolls.
  const headerCollapse = scrollY.interpolate({
    inputRange: [0, Math.max(1, titleSpace)],
    outputRange: [0, -titleSpace],
    extrapolate: "clamp",
  });
  return (
    <SafeAreaView
      style={styles.screen}
      edges={["top", "bottom", "left", "right"]}
    >
      {/* The expanded player overlays this content; hide it from TalkBack
          meanwhile. The docked bar leaves the page usable. */}
      <View
        style={{ flex: 1 }}
        importantForAccessibility={
          playing && !playerMini ? "no-hide-descendants" : "auto"
        }
        accessibilityElementsHidden={!!playing && !playerMini}
      >
        {!!error && !manage && !rename && !form && (
          <View style={{ padding: 12 }}>
            <Notice title={error} error />
            <Button secondary label="关闭提示" onPress={() => setError("")} />
          </View>
        )}
        {tab === "settings" ? (
          <SettingsScreen
            sourceCount={sources.length}
            remoteAllowed={remoteAllowed}
            revokePending={revokePending}
            artworkAllowed={artworkAllowed}
            artworkSaving={artworkSaving}
            artworkRevokePending={artworkRevokePending}
            onRetryArtworkRevoke={() => void changeArtwork(false)}
            onArtworkChange={(value) => void changeArtwork(value)}
            regionConsented={
              region.preference.ipAllowed ||
              region.preference.locationAllowed ||
              region.revokePending
            }
            regionBusy={region.busy}
            onRevokeRegion={() => void region.revokeConsent()}
            mobileWarning={mobileWarning}
            onManageSources={() => {
              setError("");
              setManage(true);
            }}
            onRevoke={() => void revoke()}
            onAllowRemote={() => void guardRemote()}
            onMobileWarningChange={(v) => {
              setMobileWarning(v);
              void repo.setSetting("mobileWarning", v).catch(() => {
                setMobileWarning(!v);
                setError("设置保存失败");
              });
            }}
            swipeReverse={swipeReverse}
            onSwipeReverseChange={(v) => {
              setSwipeReverse(v);
              void repo.setSetting("swipeReverse", v).catch(() => {
                setSwipeReverse(!v);
                setError("设置保存失败");
              });
            }}
            skipUnreachable={skipUnreachable}
            onSkipUnreachableChange={(v) => {
              setSkipUnreachable(v);
              void repo.setSetting("skipUnreachable", v).catch(() => {
                setSkipUnreachable(!v);
                setError("设置保存失败");
              });
            }}
            onClearAll={() => void clearAll()}
          />
        ) : (
          // Clip: the collapsing title must not slide over the status bar.
          <View style={{ flex: 1, overflow: "hidden" }}>
            <Animated.FlatList<ListItem>
              testID="channel-list"
              ref={listRef}
              data={listData}
              extraData={listHeaderProps}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onScroll={onListScroll}
              onScrollBeginDrag={scrollRestore.cancel}
              // Each tab's offset is recorded when a drag or fling settles.
              onScrollEndDrag={(e) => {
                const y = e.nativeEvent.contentOffset.y;
                if (!listLoading && scrollRestore.scrolled(y))
                  tabOffsets.current[tab] = y;
              }}
              onMomentumScrollEnd={(e) => {
                const y = e.nativeEvent.contentOffset.y;
                if (!listLoading && scrollRestore.scrolled(y))
                  tabOffsets.current[tab] = y;
              }}
              scrollEventThrottle={16}
              keyExtractor={listKey}
              // Rows share one height, so the list places them without
              // measuring; a cell also holds the separator below it. Render
              // far enough ahead of a fast Android fling as well.
              getItemLayout={(_, index) => {
                const layout = channelRowLayout(
                  channelRowHeight(fontScale),
                  index,
                  headerHeight + 12,
                );
                return { ...layout, length: layout.length + CHANNEL_ROW_GAP };
              }}
              initialNumToRender={12}
              maxToRenderPerBatch={16}
              updateCellsBatchingPeriod={16}
              windowSize={21}
              removeClippedSubviews={false}
              contentContainerStyle={[
                styles.content,
                { paddingTop: headerHeight + 12 },
                // Keep the last rows clear of the docked player bar.
                playing && playerMini && { paddingBottom: MINI_BAR_SPACE },
              ]}
              ItemSeparatorComponent={ListSeparator}
              renderItem={({ item }) => {
                if (item === EMPTY_ROW)
                  return (
                    <ChannelListEmpty
                      tab={listTab}
                      loading={listLoading}
                      error={listError}
                      hasSources={sources.length > 0}
                      filtered={
                        !!query ||
                        !!sourceId ||
                        group !== null ||
                        language !== null ||
                        country !== null
                      }
                      onRetry={changed}
                      onAddUrl={() => startForm("url")}
                      onAddFile={() => startForm("file")}
                      onShowAll={() => {
                        setRecentEditing(false);
                        setTab("all");
                        filters.reset();
                        void region.selectManualCountry(null);
                      }}
                    />
                  );
                return (
                  <ChannelRow
                    channel={item as Channel}
                    artworkEnabled={
                      artworkAllowed && remoteAllowed && !revokePending
                    }
                    onPlay={onRowPlay}
                    onFavorite={onRowFavorite}
                    onRemoveRecent={
                      tab === "recent" && recentEditing
                        ? onRowRemoveRecent
                        : undefined
                    }
                    recentBusy={recentBusy}
                  />
                );
              }}
            />
            <Animated.View
              testID="channel-header-overlay"
              style={[
                s.headerOverlay,
                { transform: [{ translateY: headerCollapse }] },
              ]}
              onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
            >
              <View
                onLayout={(e) =>
                  // Title plus the gap above the bar collapses away.
                  setTitleSpace(e.nativeEvent.layout.height + 20)
                }
              >
                <ChannelListTitle {...listHeaderProps} />
              </View>
              <ChannelFilterBar key={listTab} {...listHeaderProps} />
            </Animated.View>
          </View>
        )}
        <View onLayout={(e) => setTabsHeight(e.nativeEvent.layout.height)}>
          <BottomTabs tab={tab} onChange={changeTab} />
        </View>
      </View>
      <SourceManagerModal
        visible={manage}
        error={error}
        onDismissError={() => setError("")}
        sources={sources}
        check={check}
        summaries={checkSummaries}
        onClose={() => setManage(false)}
        onAdd={(kind) => {
          setManage(false);
          startForm(kind);
        }}
        onRefresh={(s) => {
          setManage(false);
          void refresh(s);
        }}
        onRename={(s) => {
          setError("");
          setRename(s);
          setRenameText(s.name);
          setManage(false);
        }}
        onRemove={(s) => void remove(s)}
        onCheck={(s) => void runCheck(s)}
        onStopCheck={stopCheck}
        languageLookup={languageLookup}
        languageMessages={languageMessages}
        onLookupLanguages={(s) => void runLanguageLookup(s)}
        onStopLanguageLookup={stopLanguageLookup}
      />
      <RenameSourceModal
        source={rename}
        error={error}
        onDismissError={() => setError("")}
        text={renameText}
        onChangeText={(text) => {
          setRenameText(text);
          setError("");
        }}
        onSave={() => {
          setError("");
          if (rename)
            void repo
              .renameSource(rename.id, renameText.trim())
              .then(() => {
                setRename(null);
                setManage(true);
                changed();
              })
              .catch(() => setError("改名失败"));
        }}
        onCancel={() => {
          setRename(null);
          setManage(true);
        }}
      />
      <SourceFormModal
        form={form}
        busy={busy}
        error={formError || error}
        onUpdate={updateForm}
        onChooseFile={() => void chooseFile()}
        onPreview={() => void preview()}
        onSave={() => void save()}
        onClose={() => void closeForm()}
      />
      {playing && (
        // One tree position for both sizes, so shrinking to the bar and
        // expanding again never remounts the session or its native player.
        <View
          testID="player-container"
          style={
            playerMini
              ? [s.miniContainer, { bottom: tabsHeight + 8 }]
              : s.playerOverlay
          }
        >
          <PlayerScreen
            mini={playerMini}
            onMinimize={() => setPlayerMini(true)}
            onExpand={() => setPlayerMini(false)}
            error={error}
            onDismissError={() => setError("")}
            channel={playing}
            channels={playQueue}
            sources={playingSources}
            artworkEnabled={artworkAllowed && remoteAllowed && !revokePending}
            sheet={{
              filters: listHeaderProps,
              onTabChange: changeTab,
              channels: rows,
              rangeKey: hasCurrentList
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
              loading: listLoading,
              onLocate: () => {
                restoreTab.current = "all";
                tabOffsets.current.all = 0;
                setRecentEditing(false);
                if (tab !== "all") changeTab("all");
                filters.reset();
                filters.setCountryBypass(countryKey);
              },
            }}
            onSelect={(channel, queue) => void play(channel, queue)}
            onSelectSource={(source) => {
              if (
                (source.groupKey ?? source.id) !==
                (playing.groupKey ?? playing.id)
              )
                return;
              setPlaying(source);
            }}
            onClose={() => {
              lastWatched.current = playing;
              setPlaying(null);
              setPlayingSources([]);
              setPlayerMini(false);
            }}
            onFavorite={(c) => void favorite(c)}
            onStarted={(c) => {
              // Only the recent list changes; re-reading a 10k-row channel tab
              // here would compete with stream start-up.
              void repo
                .recordRecent(c.id)
                .then(async () => {
                  if (tab === "recent") changed();
                  else setRecent(await repo.listChannels({ mode: "recent" }));
                })
                .catch(() => setError("观看记录未能保存"));
            }}
            remoteAllowed={remoteAllowed}
            mobileWarning={mobileWarning && !mobileAccepted}
            onMobileAccepted={() => setMobileAccepted(true)}
            swipeReverse={swipeReverse}
            skipUnreachable={skipUnreachable}
            // Prefer a fresh row: a refresh may have changed the channel.
            previousChannel={
              previousChannel
                ? ([...playQueue, ...channels, ...recent].find(
                    (c) => c.id === previousChannel.id,
                  ) ?? previousChannel)
                : null
            }
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  playerOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.bg,
  },
  miniContainer: {
    position: "absolute",
    left: 8,
    right: 8,
    borderRadius: 14,
    backgroundColor: colors.raised,
    // Elevation keeps the bar above list rows on Android.
    elevation: 6,
  },
  headerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 20,
    paddingHorizontal: 20,
    backgroundColor: colors.bg,
  },
});
