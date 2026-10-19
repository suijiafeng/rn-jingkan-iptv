import React, { useEffect, useState } from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  StyleSheet,
  View,
} from "react-native";
import { Button, Heading, Notice } from "../../components/ui";
import { ActiveFacetChips, FacetToggle, activeMenuFacets } from "./FacetChips";
import { FacetFilters } from "../../components/FacetFilters";
import type {
  ChannelFacetOptions,
  ChannelFacetSelection,
  FacetKind,
} from "../../domain/channelFacets";
import type { Source } from "../../domain/types";
import { colors, sizes, styles, type } from "../../theme";

export type Tab = "all" | "favorites" | "recent" | "settings";
export type ListTab = Exclude<Tab, "settings">;

export interface HeaderProps {
  tab: ListTab;
  /** Background availability check after a category switch. */
  autoCheck?: { done: number; total: number } | null;
  sources: Source[];
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
    <View style={partStyles.topRow}>
      <View style={{ flex: 1 }}>
        <Heading
          title={
            tab === "all" ? "频道" : tab === "favorites" ? "收藏" : "最近观看"
          }
        />
      </View>
      {tab === "recent" && (
        <View style={partStyles.headerActions}>
          {props.recentEditing && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="清空最近观看"
              accessibilityState={{ disabled: clearRecentDisabled }}
              disabled={clearRecentDisabled}
              onPress={props.onClearRecent}
              style={({ pressed }) => [
                partStyles.headerAction,
                {
                  opacity: clearRecentDisabled ? 0.4 : pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={partStyles.dangerText}>清空</Text>
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
              partStyles.headerAction,
              {
                opacity: toggleRecentDisabled ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={partStyles.actionText}>
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
    /** Player: fold the search field (shown only while a search is active). */
    foldSearch?: boolean;
    /** Player: fold the country/language triggers (shown while one is set). */
    foldTriggers?: boolean;
  },
) {
  const { tab, idPrefix = "channel" } = props;
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // Country/language menus stay folded behind one icon until asked for.
  const [facetsOpen, setFacetsOpen] = useState(false);
  const facetMenus = tab === "all" && !props.foldTriggers;
  // An expanded row is one level: the back key folds it before anything else.
  const rowOpen = sourcesOpen || facetsOpen;
  useEffect(() => {
    if (!rowOpen) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setSourcesOpen(false);
        setFacetsOpen(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [rowOpen]);
  const selectedSource = props.sources.find(
    (source) => source.id === props.sourceId,
  );
  if (!hasFilterBar(props)) return null;
  return (
    <View
      style={[partStyles.filterBar, props.compact && partStyles.compactBar]}
    >
      <View
        style={[partStyles.searchLine, props.foldSearch && partStyles.hidden]}
      >
        <View style={[partStyles.searchRow, { flex: 1 }]}>
          <TextInput
            accessibilityLabel="搜索频道名称"
            style={partStyles.searchInput}
            placeholder="搜索"
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
              style={partStyles.clearSearch}
            >
              <Text style={partStyles.clearText}>清除搜索</Text>
            </Pressable>
          )}
        </View>
        {/* A stale scope (its source since disabled) keeps its × too. */}
        {tab === "all" && (props.sources.length > 1 || !!props.sourceId) && (
          <View style={partStyles.sourceGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={sourcesOpen ? "收起来源筛选" : "展开来源筛选"}
              accessibilityState={{ expanded: sourcesOpen }}
              onPress={() => setSourcesOpen((value) => !value)}
              style={({ pressed }) => [
                partStyles.sourceToggle,
                !!props.sourceId && partStyles.sourceToggleOn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text numberOfLines={1} style={partStyles.sourceText}>
                {props.sourceId
                  ? selectedSource?.name || "来源"
                  : `来源 ${sourcesOpen ? "▴" : "▾"}`}
              </Text>
            </Pressable>
            {/* The chip itself shows the scope; × beside it clears it. */}
            {!!props.sourceId && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="清除来源筛选"
                onPress={() => props.onSourceChange("")}
                style={({ pressed }) => [
                  partStyles.sourceClear,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={partStyles.sourceText}>×</Text>
              </Pressable>
            )}
          </View>
        )}
        {facetMenus && (
          <FacetToggle
            open={facetsOpen}
            active={activeMenuFacets(props.facetSelection).length > 0}
            onPress={() => setFacetsOpen((open) => !open)}
          />
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
            {props.sources.map((source) => (
              <Button
                key={source.id}
                label={source.name}
                secondary={props.sourceId !== source.id}
                selected={props.sourceId === source.id}
                onPress={() => {
                  props.onSourceChange(source.id);
                  setSourcesOpen(false);
                }}
              />
            ))}
          </ScrollView>
        </View>
      )}
      {facetMenus && !facetsOpen && (
        <ActiveFacetChips
          selection={props.facetSelection}
          onChange={props.onFacetChange}
        />
      )}
      {tab === "all" && (
        <FacetFilters
          options={props.facets}
          selected={props.facetSelection}
          onChange={props.onFacetChange}
          countryHint={props.countryHint}
          contentAsTabs
          tabsOnly={!facetMenus || !facetsOpen}
          testID={`${idPrefix}-facet-filters`}
        />
      )}
      {tab === "all" && props.autoCheck && (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="正在检测可用性"
          accessibilityValue={{
            min: 0,
            max: props.autoCheck.total,
            now: props.autoCheck.done,
          }}
          style={partStyles.checkTrack}
        >
          <View
            style={[
              partStyles.checkFill,
              {
                width: `${Math.round(
                  (props.autoCheck.done / Math.max(props.autoCheck.total, 1)) *
                    100,
                )}%`,
              },
            ]}
          />
        </View>
      )}
    </View>
  );
}

/** Title and filters together (non-sticky layouts and tests). */
export function ChannelListHeader(props: HeaderProps) {
  return (
    <View style={partStyles.header}>
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
  onManageSources: () => void;
}

export function ChannelListEmpty(props: EmptyProps) {
  if (props.loading)
    return (
      <View style={partStyles.loadingState}>
        <ChannelListSkeleton />
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
        // The button below says what to do; only the star needs a word.
        body={
          props.hasSources && !props.filtered && props.tab === "favorites"
            ? "点频道旁的星标收藏"
            : undefined
        }
      />
      {!props.hasSources ? (
        <>
          <Button label="添加节目单" onPress={props.onAddUrl} />
          <Button label="从文件导入" secondary onPress={props.onAddFile} />
        </>
      ) : !props.filtered && props.tab === "all" ? (
        <Button label="管理节目来源" onPress={props.onManageSources} />
      ) : (
        <Button label="查看全部频道" onPress={props.onShowAll} />
      )}
    </View>
  );
}

function ChannelListSkeleton() {
  return (
    <View
      accessibilityLabel="正在加载频道列表"
      accessibilityRole="progressbar"
      style={partStyles.skeletonList}
    >
      {Array.from({ length: 6 }, (_unused, rowIndex) => (
        <View key={rowIndex} style={partStyles.skeletonRow}>
          <View style={partStyles.skeletonLogo} />
          <View style={partStyles.skeletonCopy}>
            <View style={[partStyles.skeletonLine, partStyles.skeletonTitle]} />
            <View style={[partStyles.skeletonLine, partStyles.skeletonMeta]} />
          </View>
          <View style={partStyles.skeletonAction} />
        </View>
      ))}
    </View>
  );
}

const partStyles = StyleSheet.create({
  header: { gap: 10, marginBottom: 12 },
  loadingState: { gap: 12 },
  skeletonList: { gap: 10 },
  skeletonRow: {
    minHeight: 68,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.raised,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  skeletonLogo: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.line,
  },
  skeletonCopy: { flex: 1, gap: 8 },
  skeletonLine: { height: 10, borderRadius: 5, backgroundColor: colors.line },
  skeletonTitle: { width: "62%" },
  skeletonMeta: { width: "38%", opacity: 0.7 },
  skeletonAction: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.line,
  },
  // Opaque so rows scrolling underneath never show through the pinned bar.
  filterBar: { gap: 10, paddingVertical: 8, backgroundColor: colors.bg },
  compactBar: { gap: 8, paddingVertical: 0, backgroundColor: "transparent" },
  hidden: { display: "none" },
  searchLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sourceToggle: {
    minWidth: sizes.field,
    minHeight: sizes.field,
    maxWidth: 144,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: colors.raised,
  },
  sourceToggleOn: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: colors.accentSoft,
  },
  sourceGroup: { flexDirection: "row" },
  sourceClear: {
    minWidth: sizes.field,
    minHeight: sizes.field,
    alignItems: "center",
    justifyContent: "center",
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    backgroundColor: colors.accentSoft,
  },
  sourceText: { ...type.body, color: colors.accent },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  headerAction: {
    minHeight: sizes.touch,
    minWidth: sizes.touch,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { ...type.body, color: colors.accent },
  dangerText: { ...type.body, color: colors.bad },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.raised,
    borderRadius: 14,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: sizes.field,
    paddingHorizontal: 14,
    paddingVertical: 8,
    color: colors.text,
    fontSize: type.body.fontSize,
  },
  clearSearch: {
    minWidth: sizes.field,
    minHeight: sizes.field,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  clearText: { ...type.muted, color: colors.accent },
  checkTrack: {
    height: 2,
    borderRadius: 1,
    overflow: "hidden",
    backgroundColor: colors.raised,
  },
  checkFill: { height: 2, backgroundColor: colors.accent },
});
