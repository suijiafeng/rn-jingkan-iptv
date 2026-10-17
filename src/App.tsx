import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as Network from "expo-network";
import { openRepository, Repository } from "./data/repository";
import {
  Channel,
  ImportPreview,
  Source,
  SourceKind,
  RefreshToken,
  IMPORT_ISSUE_LABELS,
  ImportIssueReason,
} from "./domain/types";
import { parseM3U } from "./domain/m3u";
import {
  downloadPlaylist,
  ImportIOError,
  readPickedFile,
} from "./data/importIO";
import { Button, Card, Heading, Notice } from "./components/ui";
import { ChannelRow } from "./components/ChannelRow";
import { colors, styles } from "./theme";
import { PlayerScreen } from "./features/player/PlayerScreen";
import {
  isOffline,
  mightUseMobileData,
} from "./features/player/playbackController";

const RISK =
  "本应用直接连接你选择的服务器，服务器会收到 IP 地址与访问请求。HTTP 内容可能被旁观或篡改；即使主链接为 HTTPS，直播子清单、分片、密钥或重定向也可能使用 HTTP。本版本没有完整的 DNS、重定向与内网隔离保护。仅使用你信任且有权观看的来源。允许后适用于所有联网导入和播放；可随时在设置撤销。";
const confirm = (
  title: string,
  message: string,
  action = "确认",
): Promise<boolean> =>
  new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: "取消", style: "cancel", onPress: () => resolve(false) },
        { text: action, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
type Tab = "all" | "favorites" | "recent" | "settings";
type Form = {
  kind: SourceKind;
  name: string;
  url: string;
  fileName: string;
  content: string;
  preview: ImportPreview | null;
  refresh: RefreshToken | null;
};
const initialForm = (kind: SourceKind = "url"): Form => ({
  kind,
  name: "",
  url: "",
  fileName: "",
  content: "",
  preview: null,
  refresh: null,
});
export default function App() {
  const [repo, setRepo] = useState<Repository | null>(null),
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
    [mobileWarning, setMobileWarning] = useState(true),
    // One confirmation covers this metered connection until Wi-Fi returns.
    [mobileAccepted, setMobileAccepted] = useState(false),
    [form, setForm] = useState<Form | null>(null),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(""),
    [manage, setManage] = useState(false),
    [rename, setRename] = useState<Source | null>(null),
    [renameText, setRenameText] = useState("");
  const [playing, setPlaying] = useState<Channel | null>(null),
    [playQueue, setPlayQueue] = useState<Channel[]>([]),
    [revision, setRevision] = useState(0);
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0),
    saving = useRef(false),
    loadGeneration = useRef(0),
    mounted = useRef(true),
    remoteRef = useRef(false),
    permissionEpoch = useRef(0);
  // Each bottom tab keeps its own scroll position across tab switches.
  const listRef = useRef<FlatList<Channel>>(null),
    tabOffsets = useRef<Partial<Record<Tab, number>>>({}),
    restoreTab = useRef<Tab | null>(null);
  const changed = useCallback(() => setRevision((v) => v + 1), []);
  const cancelTask = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
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
        if (active)
          setError(
            "本地资料未能打开。请关闭应用后重新打开；不会自动清空数据。",
          );
      });
    return () => {
      active = false;
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => {
    if (!repo) return;
    const id = ++loadGeneration.current;
    Promise.all([
      repo.listSources(),
      repo.listChannels({
        mode: tab === "settings" ? "all" : tab,
        sourceId: sourceId || undefined,
        groupName: group || undefined,
        search: query,
      }),
      repo.listGroups(sourceId || undefined),
      repo.listChannels({ mode: "recent" }),
    ])
      .then(([s, c, g, r]) => {
        if (id === loadGeneration.current) {
          setSources(s);
          setChannels(c);
          setGroups(g);
          setRecent(r);
          if (restoreTab.current === tab) {
            restoreTab.current = null;
            const offset = tabOffsets.current[tab] ?? 0;
            requestAnimationFrame(() =>
              listRef.current?.scrollToOffset({ offset, animated: false }),
            );
          }
        }
      })
      .catch(() => setError("读取资料失败，请重试"));
  }, [repo, tab, sourceId, group, query, revision]);
  useEffect(() => {
    const sub = Network.addNetworkStateListener((net) => {
      if (!isOffline(net) && !mightUseMobileData(net)) setMobileAccepted(false);
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" && controller.current) cancelTask();
    });
    return () => sub.remove();
  }, [cancelTask]);
  const guardRemote = async () => {
    if (remoteRef.current) return true;
    const epoch = permissionEpoch.current;
    const ok = await confirm("允许访问节目来源？", RISK, "了解风险并允许");
    if (!ok || !repo || epoch !== permissionEpoch.current || !mounted.current)
      return false;
    await repo.setSetting("remoteAllowed", true);
    remoteRef.current = true;
    setRemoteAllowed(true);
    return true;
  };
  const checkNetwork = async () => {
    const net = await Network.getNetworkStateAsync();
    if (isOffline(net))
      throw new ImportIOError("当前没有可用网络，请连接后重试");
    // Same rule as playback: VPN/unknown transports may be metered.
    if (mobileWarning && !mobileAccepted && mightUseMobileData(net)) {
      const ok = await confirm(
        "可能使用移动数据？",
        "下载节目单或播放直播会消耗流量。确认后，在连回 Wi-Fi 之前不再询问。",
        "继续",
      );
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
      return false;
    });
    return () => sub.remove();
  });
  const startForm = (kind: SourceKind) => {
    setForm(initialForm(kind));
    setFormError("");
  };
  const updateForm = (patch: Partial<Form>) =>
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
      setSourceId("");
      setGroup("");
      setSearch("");
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
  const favorite = async (c: Channel) => {
    if (!repo) return;
    try {
      const fav = await repo.toggleFavorite(c.id);
      const patch = (x: Channel) =>
        x.id === c.id ? { ...x, favorite: fav } : x;
      setPlaying((p) => (p ? patch(p) : p));
      setPlayQueue((q) => q.map(patch));
      setRecent((r) => r.map(patch));
      if (tab === "favorites" && fav) {
        // A channel newly favorited from the player belongs in this list.
        changed();
        return;
      }
      // Patch in place instead of re-querying thousands of rows per tap.
      setChannels((list) =>
        tab === "favorites"
          ? list.filter((x) => x.id !== c.id)
          : list.map(patch),
      );
      setSources(await repo.listSources());
    } catch {
      setError("收藏未能保存，请重试");
    }
  };
  const play = async (c: Channel, queue = channels) => {
    if (!c.active) return;
    const epoch = permissionEpoch.current;
    try {
      if (!(await guardRemote()) || epoch !== permissionEpoch.current) return;
      setPlayQueue(queue.filter((x) => x.active));
      setPlaying(c);
    } catch {
      setError("无法保存网络许可，请重试");
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
    if (playing?.sourceId === s.id) setPlaying(null);
    repo.cancelRefresh(s.id);
    try {
      await repo.deleteSource(s.id);
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
      !(await confirm(
        "撤销联网许可？",
        "将停止播放并取消导入。下次联网前会再次说明风险。",
        "撤销",
      ))
    )
      return;
    permissionEpoch.current++;
    remoteRef.current = false;
    setRemoteAllowed(false);
    setPlaying(null);
    cancelTask();
    try {
      await repo.setSetting("remoteAllowed", false);
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
    setPlaying(null);
    cancelTask();
    try {
      await repo.clearAll();
      setMobileWarning(true);
      setMobileAccepted(false);
      setSourceId("");
      setGroup("");
      setSearch("");
      setTab("all");
      changed();
    } catch {
      setError("清理未完成，请重试");
    }
  };
  if (!repo)
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <Heading title="静看" subtitle="只留下你想看的频道" />
          {error ? (
            <Notice title={error} error />
          ) : (
            <ActivityIndicator color={colors.accent} />
          )}
        </View>
      </SafeAreaView>
    );
  const listHeader = (
    <View style={{ gap: 12, marginBottom: 12 }}>
      <Heading
        title={
          tab === "all" ? "全部频道" : tab === "favorites" ? "收藏" : "最近观看"
        }
        subtitle={
          tab === "favorites"
            ? "随手打开，都是常看的"
            : tab === "recent"
              ? "只记录成功播放的频道"
              : `${sources.length} 份节目单 · 当前 ${channels.length} 个频道`
        }
      />
      {tab === "favorites" && recent[0]?.active && (
        <>
          <Image
            source={require("../assets/quiet-landscape.png")}
            style={{ width: "100%", height: 170 }}
            resizeMode="contain"
            accessibilityLabel="静看山景插画"
          />
          <Text style={styles.heading}>上次看到 · {recent[0].name}</Text>
          <Button
            label="继续观看"
            onPress={() => void play(recent[0], recent)}
          />
        </>
      )}
      <TextInput
        accessibilityLabel="搜索频道名称"
        style={styles.input}
        placeholder="搜索频道名称…"
        placeholderTextColor={colors.muted}
        value={search}
        onChangeText={setSearch}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        <Button
          label="所有来源"
          secondary={!!sourceId}
          onPress={() => {
            setSourceId("");
            setGroup("");
          }}
        />
        {sources.map((s) => (
          <Button
            key={s.id}
            label={s.name}
            secondary={sourceId !== s.id}
            onPress={() => {
              setSourceId(s.id);
              setGroup("");
            }}
          />
        ))}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        <Button
          label="全部分组"
          secondary={!!group}
          onPress={() => setGroup("")}
        />
        {groups.map((g) => (
          <Button
            key={g}
            label={g}
            secondary={g !== group}
            onPress={() => setGroup(g)}
          />
        ))}
      </ScrollView>
      <Text style={styles.muted}>
        范围：{sources.find((s) => s.id === sourceId)?.name || "所有来源"} ·{" "}
        {group || "全部分组"}
      </Text>
    </View>
  );
  return (
    <SafeAreaView
      style={styles.screen}
      edges={["top", "bottom", "left", "right"]}
    >
      {error && (
        <View style={{ padding: 12 }}>
          <Notice title={error} error />
          <Button secondary label="关闭提示" onPress={() => setError("")} />
        </View>
      )}
      {tab === "settings" ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Heading title="设置" subtitle="简单一点，安静地看" />
          <Button
            label="管理节目来源"
            secondary
            onPress={() => setManage(true)}
          />
          <Card>
            <Text style={styles.heading}>联网与 HTTP 许可</Text>
            <Text style={styles.body}>
              {remoteAllowed
                ? "已允许可信来源联网，可能包含明文内容"
                : "未允许联网，频道资料仍可离线查看"}
            </Text>
            <Button
              secondary
              label={remoteAllowed ? "撤销联网许可" : "阅读风险并允许"}
              onPress={() => void (remoteAllowed ? revoke() : guardRemote())}
            />
          </Card>
          <Card>
            <View style={styles.row}>
              <Text style={[styles.body, { flex: 1 }]}>移动网络提醒</Text>
              <Switch
                accessibilityLabel="移动网络提醒"
                value={mobileWarning}
                trackColor={{ true: colors.accent }}
                onValueChange={(v) => {
                  setMobileWarning(v);
                  void repo.setSetting("mobileWarning", v).catch(() => {
                    setMobileWarning(!v);
                    setError("设置保存失败");
                  });
                }}
              />
            </View>
          </Card>
          <Button
            secondary
            label="清空最近观看"
            onPress={() => {
              void (async () => {
                if (
                  await confirm(
                    "清空最近观看？",
                    "只删除观看记录，收藏与频道保留。",
                    "清空",
                  )
                ) {
                  await repo.clearRecent();
                  changed();
                }
              })().catch(() => setError("清理失败，请重试"));
            }}
          />
          <Button
            secondary
            danger
            label="清空全部本地资料"
            onPress={() => void clearAll()}
          />
          <Notice
            title="静看 0.1.0 · 个人测试版"
            body="无广告、无账号、无统计。资料只保存在本机。直播源本身可能含广告。只观看你有权访问的内容。"
          />
          <Text style={styles.muted}>{RISK}</Text>
        </ScrollView>
      ) : (
        <FlatList
          ref={listRef}
          data={channels}
          onScroll={(e) => {
            tabOffsets.current[tab] = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={100}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.content}
          ListHeaderComponent={listHeader}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => (
            <ChannelRow
              channel={item}
              onPlay={() => void play(item)}
              onFavorite={() => void favorite(item)}
            />
          )}
          ListEmptyComponent={
            <View style={{ gap: 12 }}>
              <Notice
                title={
                  !sources.length
                    ? "从一份节目单开始"
                    : query || sourceId || group
                      ? "没有找到频道"
                      : tab === "favorites"
                        ? "还没有收藏"
                        : tab === "recent"
                          ? "还没有观看记录"
                          : "没有可用频道"
                }
                body={
                  !sources.length
                    ? "添加你信任的 M3U 链接或本地文件。频道、收藏和最近观看保存在这台手机。"
                    : "可以清空筛选，或去频道页看看。"
                }
              />
              {!sources.length ? (
                <>
                  <Button label="添加节目单" onPress={() => startForm("url")} />
                  <Button
                    label="从文件导入"
                    secondary
                    onPress={() => startForm("file")}
                  />
                </>
              ) : (
                <Button
                  label="查看全部频道"
                  onPress={() => {
                    setTab("all");
                    setSourceId("");
                    setGroup("");
                    setSearch("");
                  }}
                />
              )}
            </View>
          }
        />
      )}
      <View
        style={{
          flexDirection: "row",
          gap: 6,
          paddingHorizontal: 20,
          paddingVertical: 12,
          borderTopWidth: 1,
          borderColor: colors.line,
        }}
      >
        {(
          [
            ["favorites", "收藏"],
            ["all", "频道"],
            ["recent", "最近"],
            ["settings", "设置"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            label={label}
            secondary={tab !== key}
            onPress={() => {
              if (key === tab) return;
              restoreTab.current = key;
              setTab(key);
            }}
            style={{ flex: 1, paddingHorizontal: 4 }}
          />
        ))}
      </View>
      <Modal
        visible={manage}
        animationType="slide"
        onRequestClose={() => setManage(false)}
      >
        <SafeAreaView style={styles.screen}>
          <ScrollView contentContainerStyle={styles.content}>
            <Heading
              title="管理节目来源"
              subtitle={`${sources.length} 份节目单 · 手动刷新，不自动联网`}
            />
            <Button
              label="添加节目单"
              onPress={() => {
                setManage(false);
                startForm("url");
              }}
            />
            <Button
              label="从文件导入"
              secondary
              onPress={() => {
                setManage(false);
                startForm("file");
              }}
            />
            {sources.map((s) => (
              <Card key={s.id}>
                <Text style={styles.heading}>{s.name}</Text>
                <Text style={styles.muted}>
                  {s.channelCount} 个频道 · {s.favoriteCount} 个收藏
                  {String.fromCharCode(10)}上次更新{" "}
                  {new Date(s.lastSuccessAt).toLocaleString()}
                </Text>
                {s.lastErrorCategory && (
                  <Text style={{ color: colors.warn }}>
                    上次刷新未完成，旧频道已保留。
                  </Text>
                )}
                <Button
                  label={
                    s.kind === "file" ? "重新解析 / 更换文件" : "刷新并预览"
                  }
                  secondary
                  onPress={() => {
                    setManage(false);
                    void refresh(s);
                  }}
                />
                <View style={styles.row}>
                  <Button
                    label="改名"
                    secondary
                    style={{ flex: 1 }}
                    onPress={() => {
                      setRename(s);
                      setRenameText(s.name);
                      setManage(false);
                    }}
                  />
                  <Button
                    label="删除"
                    secondary
                    danger
                    style={{ flex: 1 }}
                    onPress={() => void remove(s)}
                  />
                </View>
              </Card>
            ))}
            <Button secondary label="返回" onPress={() => setManage(false)} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal
        visible={!!rename}
        animationType="slide"
        onRequestClose={() => setRename(null)}
      >
        <SafeAreaView style={styles.screen}>
          <View style={styles.content}>
            <Heading title="来源改名" />
            <TextInput
              accessibilityLabel="来源名称"
              style={styles.input}
              value={renameText}
              onChangeText={setRenameText}
              maxLength={100}
            />
            <Button
              label="保存名称"
              disabled={!renameText.trim()}
              onPress={() => {
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
            />
            <Button
              label="取消"
              secondary
              onPress={() => {
                setRename(null);
                setManage(true);
              }}
            />
          </View>
        </SafeAreaView>
      </Modal>
      <Modal
        visible={!!form}
        animationType="slide"
        onRequestClose={() => void closeForm()}
      >
        <SafeAreaView style={styles.screen}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
            >
              {form && (
                <>
                  <Heading
                    title={
                      form.preview
                        ? "确认导入"
                        : form.refresh
                          ? "刷新节目单"
                          : "添加节目单"
                    }
                    subtitle={
                      form.preview
                        ? "确认后才保存，已有资料不会提前改动"
                        : "仅使用你信任且有权访问的来源"
                    }
                  />
                  {formError && (
                    <Notice
                      title={formError}
                      error
                      body="你的输入已保留。没有提前修改频道。"
                    />
                  )}
                  {!form.preview ? (
                    <>
                      <Text style={styles.body}>来源名称</Text>
                      <TextInput
                        accessibilityLabel="来源名称"
                        editable={!busy && !form.refresh}
                        style={styles.input}
                        value={form.name}
                        maxLength={100}
                        placeholder="可留空，使用主机或文件名"
                        placeholderTextColor={colors.muted}
                        onChangeText={(v) => updateForm({ name: v })}
                      />
                      {!form.refresh && (
                        <View style={styles.row}>
                          <Button
                            style={{ flex: 1 }}
                            secondary={form.kind !== "url"}
                            label="链接"
                            disabled={busy}
                            onPress={() => updateForm({ kind: "url" })}
                          />
                          <Button
                            style={{ flex: 1 }}
                            secondary={form.kind !== "file"}
                            label="文件"
                            disabled={busy}
                            onPress={() => updateForm({ kind: "file" })}
                          />
                        </View>
                      )}
                      {form.kind === "url" ? (
                        <>
                          <Text style={styles.body}>节目单链接</Text>
                          <TextInput
                            accessibilityLabel="节目单链接"
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="url"
                            editable={!busy && !form.refresh}
                            style={styles.input}
                            value={form.url}
                            onChangeText={(v) => updateForm({ url: v })}
                            placeholder="https://example.com/channels.m3u"
                            placeholderTextColor={colors.muted}
                          />
                        </>
                      ) : (
                        <>
                          <Notice
                            title={form.fileName || "选择 M3U 文件"}
                            body="使用系统文件选择器，仅读取你选中的文件。上限 2 MiB，UTF-8 编码。"
                          />
                          <Button
                            label="选择 / 更换文件"
                            secondary
                            disabled={busy}
                            onPress={() => void chooseFile()}
                          />
                        </>
                      )}
                      <Notice
                        title="只导入你信任的来源"
                        body="来源服务器会收到 IP 地址与请求。HTTP 可能泄露或被篡改；首次联网前需要明确同意。"
                      />
                      <Button
                        label={busy ? "正在读取与解析…" : "解析并预览"}
                        disabled={busy}
                        onPress={() => void preview()}
                      />
                    </>
                  ) : (
                    <>
                      <Notice
                        title={`${form.preview.stats.valid} 个可导入频道`}
                        body={`${form.preview.stats.duplicates} 条重复 · ${form.preview.stats.ignored} 条忽略 · ${form.preview.stats.http} 个 HTTP 频道`}
                      />
                      {Object.entries(form.preview.issueCounts).map(
                        ([reason, count]) => (
                          <Text key={reason} style={styles.muted}>
                            {IMPORT_ISSUE_LABELS[reason as ImportIssueReason]}：
                            {count}
                          </Text>
                        ),
                      )}
                      {form.preview.channels.slice(0, 5).map((c) => (
                        <Card key={c.identityKey}>
                          <Text style={styles.heading}>{c.name}</Text>
                          <Text style={styles.muted}>{c.groupName}</Text>
                        </Card>
                      ))}
                      <Text style={styles.muted}>
                        仅展示前 5 项。导入成功不代表每个频道可播放。
                      </Text>
                      <Button
                        label={
                          busy
                            ? "正在保存…"
                            : `确认保存 ${form.preview.stats.valid} 个频道`
                        }
                        disabled={busy || !form.preview.stats.valid}
                        onPress={() => void save()}
                      />
                      <Button
                        label="返回修改"
                        secondary
                        disabled={busy}
                        onPress={() => updateForm({ preview: null })}
                      />
                    </>
                  )}
                  {busy && <ActivityIndicator color={colors.accent} />}
                  <Button
                    label="取消并返回"
                    secondary
                    disabled={busy && !!form.preview}
                    onPress={() => void closeForm()}
                  />
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
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
            onSelect={setPlaying}
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
