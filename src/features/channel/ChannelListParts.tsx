import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  StyleSheet,
  View,
} from "react-native";
import { Button, Heading, Notice } from "../../components/ui";
import { FacetFilters } from "../../components/FacetFilters";
import type {
  ChannelFacetOptions,
  ChannelFacetSelection,
  FacetKind,
} from "../../domain/channelFacets";
import type { Source } from "../../domain/types";
import { colors, styles } from "../../theme";

export type Tab = "all" | "favorites" | "recent" | "settings";
export type ListTab = Exclude<Tab, "settings">;

export interface HeaderProps {
  tab: ListTab;
  /** Background availability check after a category switch. */
  autoCheck?: { done: number; total: number } | null;
  sources: Source[];
  channelCount: number;
  search: string;
  sourceId: string;
  facets: ChannelFacetOptions;
  facetSelection: ChannelFacetSelection;
  onSearchChange: (text: string) => void;
  onClearSearch: () => void;
  onSourceChange: (sourceId: string) => void;
  onFacetChange: (selection: ChannelFacetSelection, kind?: FacetKind) => void;
  countryHint?: string;
  onClearRecent: () => void;
  recentBusy: boolean;
  recentEditing: boolean;
  onToggleRecentEditing: () => void;
  recentCount: number;
}

/**
 * Title row (title, subtitle, recent-history actions). Scrolls away with the
 * list; the filter bar below it sticks to the top.
 */
export function ChannelListTitle(props: HeaderProps) {
  const { tab } = props;
  const clearRecentDisabled = props.recentBusy || props.recentCount === 0;
  const toggleRecentDisabled =
    props.recentBusy || (!props.recentEditing && props.recentCount === 0);
  return (
    <View style={s.topRow}>
      <View style={{ flex: 1 }}>
        <Heading
          title={
            tab === "all" ? "频道" : tab === "favorites" ? "收藏" : "最近观看"
          }
          subtitle={
            tab === "favorites"
              ? "随手打开，都是常看的"
              : tab === "recent"
                ? props.recentEditing
                  ? "删除记录不会影响频道和收藏"
                  : "按最近播放排序"
                : `${props.sources.length} 份节目单 · 当前 ${props.channelCount} 个频道`
          }
        />
      </View>
      {tab === "recent" && (
        <View style={s.headerActions}>
          {props.recentEditing && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="清空最近观看"
              accessibilityState={{ disabled: clearRecentDisabled }}
              disabled={clearRecentDisabled}
              onPress={props.onClearRecent}
              style={({ pressed }) => [
                s.headerAction,
                {
                  opacity: clearRecentDisabled ? 0.4 : pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={s.dangerText}>清空</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              props.recentEditing ? "完成历史管理" : "管理观看记录"
            }
            accessibilityState={{ disabled: toggleRecentDisabled }}
            disabled={toggleRecentDisabled}
            onPress={props.onToggleRecentEditing}
            style={({ pressed }) => [
              s.headerAction,
              {
                opacity: toggleRecentDisabled ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={s.actionText}>
              {props.recentEditing ? "完成" : "管理"}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Whether the sticky filter bar has anything to show for this state. */
export function hasFilterBar(
  props: Pick<HeaderProps, "tab" | "recentEditing">,
) {
  return !(props.tab === "recent" && props.recentEditing);
}

/**
 * Search, source chooser, facets and scope: stays pinned to the top while a
 * long list scrolls, so filters are reachable without scrolling back up.
 */
export function ChannelFilterBar(
  props: HeaderProps & {
    /** testID prefix, so the page and the player sheet stay distinguishable. */
    idPrefix?: string;
    /** Inside the player sheet: no own background or vertical padding. */
    compact?: boolean;
  },
) {
  const { tab, idPrefix = "channel" } = props;
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const selectedSource = props.sources.find(
    (source) => source.id === props.sourceId,
  );
  if (!hasFilterBar(props)) return null;
  return (
    <View style={[s.filterBar, props.compact && s.compactBar]}>
      <View style={s.searchLine}>
        <View style={[s.searchRow, { flex: 1 }]}>
          <TextInput
            accessibilityLabel="搜索频道名称"
            style={[s.searchInput, props.compact && s.searchInputCompact]}
            placeholder="搜索频道名称…"
            placeholderTextColor={colors.muted}
            value={props.search}
            onChangeText={props.onSearchChange}
            returnKeyType="search"
            autoCorrect={false}
          />
          {!!props.search && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="清除搜索"
              onPress={props.onClearSearch}
              style={s.clearSearch}
            >
              <Text style={s.clearText}>清除搜索</Text>
            </Pressable>
          )}
        </View>
        {tab === "all" && props.sources.length > 1 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sourcesOpen ? "收起来源筛选" : "展开来源筛选"}
            accessibilityState={{ expanded: sourcesOpen }}
            onPress={() => setSourcesOpen((value) => !value)}
            style={({ pressed }) => [
              s.sourceToggle,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text numberOfLines={1} style={s.sourceText}>
              {selectedSource?.name || "来源"} {sourcesOpen ? "▴" : "▾"}
            </Text>
          </Pressable>
        )}
      </View>
      {tab === "all" && sourcesOpen && props.sources.length > 1 && (
        <View style={{ gap: 6 }}>
          <Text style={styles.muted}>选择节目来源</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            <Button
              label="所有来源"
              secondary={!!props.sourceId}
              selected={!props.sourceId}
              onPress={() => {
                props.onSourceChange("");
                setSourcesOpen(false);
              }}
            />
            {props.sources.map((s) => (
              <Button
                key={s.id}
                label={s.name}
                secondary={props.sourceId !== s.id}
                selected={props.sourceId === s.id}
                onPress={() => {
                  props.onSourceChange(s.id);
                  setSourcesOpen(false);
                }}
              />
            ))}
          </ScrollView>
        </View>
      )}
      {tab === "all" && (
        <FacetFilters
          options={props.facets}
          selected={props.facetSelection}
          onChange={props.onFacetChange}
          countryHint={props.countryHint}
          contentAsTabs
          compact={props.compact}
          testID={`${idPrefix}-facet-filters`}
        />
      )}
      {tab === "all" && props.autoCheck && (
        <View style={s.checkRow} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={colors.muted} />
          <Text style={styles.muted}>
            检测可用性 {props.autoCheck.done}/{props.autoCheck.total}
          </Text>
        </View>
      )}
      {tab === "all" && !!props.sourceId && (
        <View style={s.scopeRow}>
          <Text style={[styles.muted, { flex: 1 }]}>
            范围：{selectedSource?.name || "所有来源"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清除来源筛选"
            style={s.reset}
            onPress={() => {
              props.onSourceChange("");
            }}
          >
            <Text style={s.clearText}>所有来源</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Title and filters together (non-sticky layouts and tests). */
export function ChannelListHeader(props: HeaderProps) {
  return (
    <View style={s.header}>
      <ChannelListTitle {...props} />
      <ChannelFilterBar {...props} />
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
            : props.filtered
              ? "试试清空搜索或筛选条件。"
              : props.tab === "favorites"
                ? "点击频道旁的星标，将常看的频道收在这里。"
                : props.tab === "recent"
                  ? "成功播放过的频道会出现在这里。"
                  : "可以添加其他节目单，或刷新现有来源。"
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
  ["all", "频道"],
  ["favorites", "收藏"],
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
          selected={tab === key}
          accessibilityRole="tab"
          onPress={() => {
            if (key !== tab) onChange(key);
          }}
          style={{ flex: 1, paddingHorizontal: 4 }}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  header: { gap: 10, marginBottom: 12 },
  // Opaque so rows scrolling underneath never show through the pinned bar.
  filterBar: { gap: 10, paddingVertical: 8, backgroundColor: colors.bg },
  compactBar: { gap: 8, paddingVertical: 0, backgroundColor: "transparent" },
  searchLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sourceToggle: {
    minWidth: 48,
    minHeight: 48,
    maxWidth: 144,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: colors.raised,
  },
  sourceText: { color: colors.accent, fontSize: 14, lineHeight: 21 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  headerAction: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { color: colors.accent, fontSize: 14, lineHeight: 21 },
  dangerText: { color: colors.bad, fontSize: 14, lineHeight: 21 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.raised,
    borderRadius: 14,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  searchInputCompact: { minHeight: 40, paddingVertical: 8, fontSize: 14 },
  clearSearch: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  clearText: { color: colors.accent, fontSize: 12, lineHeight: 18 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  scopeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  reset: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
});
