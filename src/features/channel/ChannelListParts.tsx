import React from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button, Heading, Notice } from "../../components/ui";
import { channelTitle } from "../../domain/channelLabels";
import type { Channel, Source } from "../../domain/types";
import { colors, styles } from "../../theme";

export type Tab = "all" | "favorites" | "recent" | "settings";
export type ListTab = Exclude<Tab, "settings">;

interface HeaderProps {
  tab: ListTab;
  sources: Source[];
  channelCount: number;
  resumable: Channel | undefined;
  search: string;
  sourceId: string;
  group: string;
  groups: string[];
  onResume: () => void;
  onSearchChange: (text: string) => void;
  onClearSearch: () => void;
  onSourceChange: (sourceId: string) => void;
  onGroupChange: (group: string) => void;
}

export function ChannelListHeader(props: HeaderProps) {
  const { tab, resumable } = props;
  return (
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
              : `${props.sources.length} 份节目单 · 当前 ${props.channelCount} 个频道`
        }
      />
      {tab === "favorites" && resumable && (
        <>
          <Image
            source={require("../../../assets/quiet-landscape.png")}
            style={{ width: "100%", height: 170 }}
            resizeMode="contain"
            accessibilityLabel="静看山景插画"
          />
          <Text style={styles.heading}>
            上次看到 · {channelTitle(resumable.name).title}
          </Text>
          <Button label="继续观看" onPress={props.onResume} />
        </>
      )}
      <TextInput
        accessibilityLabel="搜索频道名称"
        style={styles.input}
        placeholder="搜索频道名称…"
        placeholderTextColor={colors.muted}
        value={props.search}
        onChangeText={props.onSearchChange}
      />
      {!!props.search && (
        <Button label="清除搜索" secondary onPress={props.onClearSearch} />
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        <Button
          label="所有来源"
          secondary={!!props.sourceId}
          onPress={() => props.onSourceChange("")}
        />
        {props.sources.map((s) => (
          <Button
            key={s.id}
            label={s.name}
            secondary={props.sourceId !== s.id}
            onPress={() => props.onSourceChange(s.id)}
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
          secondary={!!props.group}
          onPress={() => props.onGroupChange("")}
        />
        {props.groups.map((g) => (
          <Button
            key={g}
            label={g}
            secondary={g !== props.group}
            onPress={() => props.onGroupChange(g)}
          />
        ))}
      </ScrollView>
      <Text style={styles.muted}>
        范围：
        {props.sources.find((s) => s.id === props.sourceId)?.name ||
          "所有来源"}{" "}
        · {props.group || "全部分组"}
      </Text>
    </View>
  );
}

interface EmptyProps {
  tab: ListTab;
  loading: boolean;
  error: string;
  hasSources: boolean;
  filtered: boolean;
  onRetry: () => void;
  onAddUrl: () => void;
  onAddFile: () => void;
  onShowAll: () => void;
}

export function ChannelListEmpty(props: EmptyProps) {
  if (props.loading)
    return (
      <View style={{ gap: 12 }}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.muted} accessibilityLiveRegion="polite">
          正在读取频道…
        </Text>
      </View>
    );
  if (props.error)
    return (
      <View style={{ gap: 12 }}>
        <Notice title={props.error} error />
        <Button label="重新读取频道" onPress={props.onRetry} />
      </View>
    );
  return (
    <View style={{ gap: 12 }}>
      <Notice
        title={
          !props.hasSources
            ? "从一份节目单开始"
            : props.filtered
              ? "没有找到频道"
              : props.tab === "favorites"
                ? "还没有收藏"
                : props.tab === "recent"
                  ? "还没有观看记录"
                  : "没有可用频道"
        }
        body={
          !props.hasSources
            ? "添加你信任的 M3U 链接或本地文件。频道、收藏和最近观看保存在这台手机。"
            : "可以清空筛选，或去频道页看看。"
        }
      />
      {!props.hasSources ? (
        <>
          <Button label="添加节目单" onPress={props.onAddUrl} />
          <Button label="从文件导入" secondary onPress={props.onAddFile} />
        </>
      ) : (
        <Button label="查看全部频道" onPress={props.onShowAll} />
      )}
    </View>
  );
}

const TABS = [
  ["favorites", "收藏"],
  ["all", "频道"],
  ["recent", "最近"],
  ["settings", "设置"],
] as const;

export function BottomTabs({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
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
      {TABS.map(([key, label]) => (
        <Button
          key={key}
          label={label}
          secondary={tab !== key}
          onPress={() => {
            if (key !== tab) onChange(key);
          }}
          style={{ flex: 1, paddingHorizontal: 4 }}
        />
      ))}
    </View>
  );
}
