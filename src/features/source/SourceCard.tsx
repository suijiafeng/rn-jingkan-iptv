import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/ui";
import { daysAgo } from "../../domain/timeAgo";
import type { Source } from "../../domain/types";
import { colors, sizes, styles, type } from "../../theme";
import type { CheckProgress, CheckSummary } from "./availability";

interface Props {
  source: Source;
  /** The one sweep that may be running, for any source. */
  check: CheckProgress | null;
  summary?: CheckSummary;
  saving: boolean;
  /** Source whose languages are being looked up, if any. */
  languageLookup: string | null;
  languageMessage?: string;
  onRefresh: (source: Source) => void;
  onRename: (source: Source) => void;
  onRemove: (source: Source) => void;
  onEnabledChange: (source: Source, enabled: boolean) => void;
  onCheck: (source: Source, force?: boolean) => void;
  onStopCheck: () => void;
  onLookupLanguages?: (source: Source) => void;
  onStopLanguageLookup?: () => void;
}

/**
 * One source in the manager. Two lines when all is well (name, then counts);
 * a third only for something that needs attention. The two everyday actions
 * stay in view; the rest fold behind "更多".
 */
export function SourceCard({
  source,
  check,
  summary,
  saving,
  languageLookup,
  languageMessage,
  ...props
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  // Day granularity: the time the manager opened is precise enough.
  const [now] = useState(() => Date.now());
  const running = check?.sourceId === source.id;
  const lookupRunning = languageLookup === source.id;
  const taskBusy = running || lookupRunning;
  const checked = !!summary || typeof source.lastCheckedAt === "number";
  const unreachable = summary ? summary.unreachable : source.unreachableCount;
  const meta = [
    // The list shows logical channels; several addresses can share one.
    source.addressCount > source.channelCount
      ? `${source.channelCount} 个频道（${source.addressCount} 个地址）`
      : `${source.channelCount} 个频道`,
    // Checks run per address, not per channel.
    checked && unreachable > 0 ? `${unreachable} 个地址暂时无法连接` : "",
    summary?.stopped ? "测试已停止" : "",
    updatedAgo(source.lastSuccessAt, now),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={cardStyles.sourceCard}>
      <View style={!source.enabled && cardStyles.dimmed}>
        <View style={cardStyles.titleLine}>
          <Text style={[styles.heading, cardStyles.title]}>{source.name}</Text>
          {!source.enabled && <Text style={cardStyles.tag}>已停用</Text>}
        </View>
        <Text style={styles.muted}>{meta}</Text>
      </View>
      {source.enabled && source.lastErrorCategory && (
        <Text style={cardStyles.warnText}>上次刷新未完成，旧频道已保留</Text>
      )}
      {running && (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="正在测试连通"
          accessibilityValue={
            check.total === null
              ? undefined
              : { min: 0, max: check.total, now: check.done }
          }
          style={cardStyles.progressLine}
        >
          <Text style={styles.muted}>
            {check.total === null
              ? "正在读取待测试频道…"
              : `正在测试连通 ${check.done}/${check.total}`}
          </Text>
          <View style={cardStyles.progressTrack}>
            <View
              style={[
                cardStyles.progressFill,
                {
                  width: `${
                    check.total
                      ? Math.min(100, (check.done / check.total) * 100)
                      : 12
                  }%`,
                },
              ]}
            />
          </View>
        </View>
      )}
      {lookupRunning && (
        <Text style={styles.muted} accessibilityLiveRegion="polite">
          正在补全语言…
        </Text>
      )}
      {!lookupRunning && languageMessage && (
        <Text style={styles.muted}>{languageMessage}</Text>
      )}
      <View style={cardStyles.actions}>
        {source.enabled ? (
          <>
            <Button
              compact
              label={
                source.lastErrorCategory
                  ? "重试刷新"
                  : source.kind === "file"
                    ? "更新节目单"
                    : "刷新"
              }
              accessibilityLabel={
                source.kind === "file" ? "更新节目单 / 更换文件" : "刷新并预览"
              }
              secondary
              style={cardStyles.action}
              disabled={saving || !!check || !!languageLookup}
              onPress={() => props.onRefresh(source)}
            />
            {running ? (
              <Button
                compact
                label="停止测试"
                secondary
                style={cardStyles.action}
                onPress={props.onStopCheck}
              />
            ) : (
              <Button
                compact
                label="测试连通"
                accessibilityLabel={checked ? "重新测试连通" : "测试连通"}
                secondary
                style={cardStyles.action}
                disabled={saving || !!check || !source.channelCount}
                onPress={() =>
                  summary ? props.onCheck(source, true) : props.onCheck(source)
                }
              />
            )}
            {lookupRunning && (
              <Button
                compact
                label="停止补全"
                accessibilityLabel="停止补全语言"
                secondary
                style={cardStyles.action}
                onPress={() => props.onStopLanguageLookup?.()}
              />
            )}
          </>
        ) : (
          // Re-enabling is the one thing a stopped source asks for.
          <Button
            compact
            label={saving ? "正在保存" : "启用"}
            accessibilityLabel="启用"
            disabled={saving}
            onPress={() => props.onEnabledChange(source, true)}
          />
        )}
        <View style={cardStyles.spacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={moreOpen ? "收起更多操作" : "更多操作"}
          accessibilityState={{ expanded: moreOpen }}
          hitSlop={4}
          onPress={() => setMoreOpen((open) => !open)}
          style={({ pressed }) => [
            cardStyles.more,
            moreOpen && cardStyles.moreOpen,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={cardStyles.moreText}>⋯</Text>
        </Pressable>
      </View>
      {moreOpen && (
        <View style={cardStyles.actions}>
          {source.enabled && props.onLookupLanguages && !lookupRunning && (
            <Button
              compact
              label="补全语言"
              secondary
              style={cardStyles.action}
              disabled={
                !!languageLookup || !!check || saving || !source.channelCount
              }
              onPress={() => props.onLookupLanguages?.(source)}
            />
          )}
          {source.enabled && (
            <Button
              compact
              label={saving ? "正在保存" : "停用"}
              accessibilityLabel="停用"
              secondary
              style={cardStyles.action}
              disabled={saving || taskBusy || !!check}
              onPress={() => props.onEnabledChange(source, false)}
            />
          )}
          <Button
            compact
            label="改名"
            secondary
            style={cardStyles.action}
            disabled={saving}
            onPress={() => props.onRename(source)}
          />
          <Button
            compact
            label="删除"
            secondary
            style={cardStyles.action}
            danger
            disabled={saving}
            onPress={() => props.onRemove(source)}
          />
        </View>
      )}
    </View>
  );
}

/** "今天更新", "昨天更新", "3 天前更新"; nothing for an unknown time. */
export function updatedAgo(timestamp: number, now: number) {
  const ago = daysAgo(timestamp, now);
  return ago ? `${ago}更新` : "";
}

const cardStyles = StyleSheet.create({
  sourceCard: {
    borderRadius: 14,
    padding: 14,
    gap: 10,
    backgroundColor: colors.surface,
  },
  dimmed: { opacity: 0.55 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flexShrink: 1 },
  tag: {
    ...type.caption,
    color: colors.muted,
    backgroundColor: colors.raised,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  warnText: { ...type.muted, color: colors.warn },
  progressLine: { gap: 6 },
  progressTrack: {
    height: 4,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: colors.raised,
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  spacer: { flex: 1 },
  // Compact secondary buttons are drawn on the page colour; on this card
  // they need their own fill and outline to read as buttons.
  action: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
  },
  more: {
    minWidth: sizes.touch,
    minHeight: sizes.touch,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  moreOpen: { backgroundColor: colors.raised },
  moreText: { ...type.heading, color: colors.muted },
});
