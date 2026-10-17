import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  FlatList,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as Network from "expo-network";
import { openRepository, Repository } from "./data/repository";
import { Channel, Source, SourceKind } from "./domain/types";
import { parseM3U } from "./domain/m3u";
import {
  downloadPlaylist,
  ImportIOError,
  readPickedFile,
} from "./data/importIO";
import { Button, Heading, Notice } from "./components/ui";
import { ChannelRow } from "./components/ChannelRow";
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
import { SettingsScreen } from "./features/settings/SettingsScreen";
import {
  BottomTabs,
  ChannelListEmpty,
  ChannelListHeader,
  ListTab,
  Tab,
} from "./features/channel/ChannelListParts";

type ListFilters = { sourceId: string; group: string; search: string };

export default function App() {
  const [repo, setRepo] = useState<Repository | null>(null),
    [startupAttempt, setStartupAttempt] = useState(0),
    [loadedRequest, setLoadedRequest] = useState<{
      tab: Tab;
      sourceId: string;
      group: string;
      query: string;
    } | null>(null),
    [listError, setListError] = useState(""),
    [error, setError] = useState(""),
    [sources, setSources] = useState<Source[]>([]),
    [channels, setChannels] = useState<Channel[]>([]),
    [recent, setRecent] = useState<Channel[]>([]);
  const [tab, setTab] = useState<Tab>("all"),
    [sourceId, setSourceId] = useState(""),
    [group, setGroup] = useState(""),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [groups, setGroups] = useState<string[]>([]);
  const [remoteAllowed, setRemoteAllowed] = useState(false),
    [revokePending, setRevokePending] = useState(false),
    [mobileWarning, setMobileWarning] = useState(true),
    // One confirmation covers this metered connection until Wi-Fi returns.
    [mobileAccepted, setMobileAccepted] = useState(false),
    [form, setForm] = useState<SourceFormState | null>(null),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(""),
    [manage, setManage] = useState(false),
    [rename, setRename] = useState<Source | null>(null),
    [renameText, setRenameText] = useState("");
  const [playing, setPlaying] = useState<Channel | null>(null),
    [playQueue, setPlayQueue] = useState<Channel[]>([]),
    [allChannels, setAllChannels] = useState<Channel[]>([]),
    [revision, setRevision] = useState(0);
  const [recentBusy, setRecentBusy] = useState(false),
    [recentEditing, setRecentEditing] = useState(false);
  const recentMutation = useRef(false);
  const [check, setCheck] = useState<CheckProgress | null>(null),
    [checkSummaries, setCheckSummaries] = useState<
      Record<string, CheckSummary>
    >({});
  const controller = useRef<AbortController | null>(null),
    checkController = useRef<AbortController | null>(null),
    generation = useRef(0),
    checkGeneration = useRef(0),
    playGeneration = useRef(0),
    saving = useRef(false),
    loadGeneration = useRef(0),
    mounted = useRef(true),
    remoteRef = useRef(false),
    permissionEpoch = useRef(0);
  // Each bottom tab keeps its own scroll position across tab switches.
  const listRef = useRef<FlatList<Channel>>(null),
    tabOffsets = useRef<Partial<Record<Tab, number>>>({}),
    tabFilters = useRef<Partial<Record<ListTab, ListFilters>>>({}),
    restoreTab = useRef<Tab | null>(null);
  const changed = useCallback(() => setRevision((v) => v + 1), []);
  const loadRequest = useMemo(
    () => ({ repo, tab, sourceId, group, query, revision }),
    [repo, tab, sourceId, group, query, revision],
  );
  const listLoading = loadedRequest !== loadRequest;
  const hasCurrentList =
    loadedRequest?.tab === tab &&
    loadedRequest.sourceId === sourceId &&
    loadedRequest.group === group &&
    loadedRequest.query === query;
  const cancelTask = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
  }, []);
  const stopCheck = useCallback(() => {
    checkController.current?.abort();
    checkController.current = null;
    setCheck(null);
  }, []);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    openRepository()
      .then(async (r) => {
        const allowed = await r.getSetting("remoteAllowed", false);
        const warning = await r.getSetting("mobileWarning", true);
        const favorites = await r.listChannels({ mode: "favorites" });
        if (active) {
          remoteRef.current = allowed;
          setRemoteAllowed(allowed);
          setMobileWarning(warning);
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
    };
  }, [startupAttempt]);
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => {
    if (!repo) return;
    let active = true;
    const id = ++loadGeneration.current;
    Promise.all([
      repo.listSources(),
      repo.listChannels({
        mode: tab === "settings" ? "all" : tab,
        sourceId: tab === "all" ? sourceId || undefined : undefined,
        groupName: tab === "all" ? group || undefined : undefined,
        search: query,
      }),
      tab === "all"
        ? repo.listGroups(sourceId || undefined)
        : Promise.resolve([]),
      repo.listChannels({ mode: "recent" }),
    ])
      .then(([s, c, g, r]) => {
        if (active && id === loadGeneration.current) {
          setListError("");
          setSources(s);
          setChannels(c);
          setGroups(g);
          setRecent(r);
          if (restoreTab.current === tab) {
            restoreTab.current = null;
            const offset = tabOffsets.current[tab] ?? 0;
            requestAnimationFrame(() => {
              if (active && id === loadGeneration.current)
                listRef.current?.scrollToOffset({ offset, animated: false });
            });
          }
        }
      })
      .catch(() => {
        if (active && id === loadGeneration.current)
          setListError("读取资料失败，你的频道与收藏仍保存在本机。");
      })
      .finally(() => {
        if (active && id === loadGeneration.current)
          setLoadedRequest(loadRequest);
      });
    return () => {
      active = false;
    };
  }, [repo, tab, sourceId, group, query, revision, loadRequest]);
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
    });
    return () => sub.remove();
  }, [cancelTask, stopCheck]);
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
      if (playing) return false;
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
        setFormError("文件读取失败或超过 2 MiB，请选择有效 UTF-8 M3U 文件。");
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
      setSourceId("");
      setGroup("");
      setSearch("");
      setQuery("");
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
    setCheck({ sourceId: s.id, done: 0, total: s.channelCount });
    try {
      if (!(await guardRemote(c.signal)) || !allowed()) return;
      if (!(await checkNetwork(c.signal)) || !allowed()) return;
      const targets = await repo.listChannels({ sourceId: s.id });
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
        x.id === c.id ? { ...x, favorite: fav } : x;
      setPlaying((p) => (p ? patch(p) : p));
      setPlayQueue((q) => q.map(patch));
      setAllChannels((q) => q.map(patch));
      setRecent((r) => r.map(patch));
      setChannels((list) => list.map(patch));
      // Re-read the current view after a write: the user may have switched tabs
      // while SQLite was saving. Never filter using the initiating tab.
      changed();
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
    setAllChannels((items) => items.map(patch));
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
  const play = async (c: Channel, queue = channels) => {
    if (!repo || !c.active) return;
    const task = ++playGeneration.current;
    const epoch = permissionEpoch.current;
    try {
      if (!(await guardRemote()) || epoch !== permissionEpoch.current) return;
      const catalog = await repo.listChannels();
      if (
        !mounted.current ||
        task !== playGeneration.current ||
        epoch !== permissionEpoch.current
      )
        return;
      const selected = catalog.find(
        (channel) => channel.id === c.id && channel.active,
      );
      if (!selected) {
        setError("频道已不可用，请重新读取频道后重试");
        return;
      }
      setAllChannels(catalog.filter((channel) => channel.active));
      setPlayQueue(queue.filter((x) => x.active));
      setPlaying(selected);
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
    if (playing?.sourceId === s.id) setPlaying(null);
    repo.cancelRefresh(s.id);
    setError("");
    try {
      await repo.deleteSource(s.id);
      for (const key of ["all", "favorites", "recent"] as const) {
        const saved = tabFilters.current[key];
        if (saved?.sourceId === s.id)
          tabFilters.current[key] = { ...saved, sourceId: "", group: "" };
      }
      if (sourceId === s.id) {
        setSourceId("");
        setGroup("");
      }
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
    cancelTask();
    stopCheck();
    try {
      await repo.setSetting("remoteAllowed", false);
      setRevokePending(false);
    } catch {
      setError("许可已在本次运行中撤销，但未能保存。请重试撤销。");
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
    cancelTask();
    stopCheck();
    try {
      await repo.clearAll();
      setRevokePending(false);
      setMobileWarning(true);
      setMobileAccepted(false);
      setCheckSummaries({});
      tabFilters.current = {};
      tabOffsets.current = {};
      setSourceId("");
      setGroup("");
      setSearch("");
      setQuery("");
      setTab("all");
      setRecentEditing(false);
      changed();
    } catch {
      setError("清理未完成，请重试");
    }
  };
  const changeTab = (key: Tab) => {
    setRecentEditing(false);
    if (tab !== "settings")
      tabFilters.current[tab] = {
        sourceId: tab === "all" ? sourceId : "",
        group: tab === "all" ? group : "",
        search,
      };
    if (key !== "settings") {
      const saved = tabFilters.current[key];
      setSourceId(key === "all" ? (saved?.sourceId ?? "") : "");
      setGroup(key === "all" ? (saved?.group ?? "") : "");
      setSearch(saved?.search ?? "");
      setQuery(saved?.search.trim() ?? "");
    }
    restoreTab.current = key;
    setTab(key);
  };
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
  return (
    <SafeAreaView
      style={styles.screen}
      edges={["top", "bottom", "left", "right"]}
    >
      {!!error && !manage && !rename && !form && (
        <View style={{ padding: 12 }}>
          <Notice title={error} error />
          <Button secondary label="关闭提示" onPress={() => setError("")} />
        </View>
      )}
      {tab === "settings" ? (
        <SettingsScreen
          remoteAllowed={remoteAllowed}
          revokePending={revokePending}
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
          onClearAll={() => void clearAll()}
        />
      ) : (
        <FlatList
          ref={listRef}
          data={!hasCurrentList || listError ? [] : channels}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScroll={(e) => {
            if (!listLoading)
              tabOffsets.current[tab] = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={100}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.content}
          ListHeaderComponent={
            <ChannelListHeader
              key={listTab}
              tab={listTab}
              sources={sources}
              channelCount={channels.length}
              search={search}
              sourceId={sourceId}
              group={group}
              groups={groups}
              recentBusy={recentBusy}
              recentEditing={recentEditing}
              recentCount={recent.length}
              onToggleRecentEditing={() => {
                if (recentBusy) return;
                if (!recentEditing) {
                  tabOffsets.current.recent = 0;
                  restoreTab.current = "recent";
                  setSearch("");
                  setQuery("");
                }
                setRecentEditing((value) => !value);
              }}
              onClearRecent={() => {
                setError("");
                void clearRecent().catch(() =>
                  setError("清空观看记录失败，请重试"),
                );
              }}
              onSearchChange={(text) => {
                tabOffsets.current[tab] = 0;
                restoreTab.current = tab;
                setSearch(text);
              }}
              onClearSearch={() => {
                tabOffsets.current[tab] = 0;
                restoreTab.current = tab;
                setSearch("");
                setQuery("");
              }}
              onSourceChange={(id) => {
                tabOffsets.current[tab] = 0;
                restoreTab.current = tab;
                setSourceId(id);
                setGroup("");
              }}
              onGroupChange={(name) => {
                tabOffsets.current[tab] = 0;
                restoreTab.current = tab;
                setGroup(name);
              }}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => (
            <ChannelRow
              channel={item}
              onPlay={() => void play(item)}
              onFavorite={() => void favorite(item)}
              onRemoveRecent={
                tab === "recent" && recentEditing
                  ? () => {
                      setError("");
                      void removeRecent(item).catch(() =>
                        setError("删除观看记录失败，请重试"),
                      );
                    }
                  : undefined
              }
              recentBusy={recentBusy}
            />
          )}
          ListEmptyComponent={
            <ChannelListEmpty
              tab={listTab}
              loading={listLoading}
              error={listError}
              hasSources={sources.length > 0}
              filtered={!!(query || sourceId || group)}
              onRetry={changed}
              onAddUrl={() => startForm("url")}
              onAddFile={() => startForm("file")}
              onShowAll={() => {
                setRecentEditing(false);
                setTab("all");
                setSourceId("");
                setGroup("");
                setSearch("");
                setQuery("");
              }}
            />
          }
        />
      )}
      <BottomTabs tab={tab} onChange={changeTab} />
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
        <View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: colors.bg,
          }}
        >
          <PlayerScreen
            channel={playing}
            channels={playQueue}
            allChannels={allChannels}
            recentChannels={recent}
            onSelect={(channel, queue) => {
              if (queue) setPlayQueue(queue);
              setPlaying(channel);
            }}
            onClose={() => setPlaying(null)}
            onFavorite={(c) => void favorite(c)}
            onStarted={(c) => {
              void repo
                .recordRecent(c.id)
                .then(changed)
                .catch(() => setError("观看记录未能保存"));
            }}
            remoteAllowed={remoteAllowed}
            mobileWarning={mobileWarning && !mobileAccepted}
            onMobileAccepted={() => setMobileAccepted(true)}
          />
        </View>
      )}
    </SafeAreaView>
  );
}
