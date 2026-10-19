import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/ui";
import type { Source } from "../../domain/types";
import { colors, styles, type } from "../../theme";
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

/** One source in the manager: status, task progress, and its actions. */
export function SourceCard({
  source,
  check,
  summary,
  saving,
  languageLookup,
  languageMessage,
  ...props
}: Props) {
  const running = check?.sourceId === source.id;
  const lookupRunning = languageLookup === source.id;
  const taskBusy = running || lookupRunning;
  const resultText = checkResultText(source, summary);
  return (
    <View
      style={[
        cardStyles.sourceCard,
        !source.enabled && cardStyles.sourceCardDisabled,
      ]}
    >
      <View style={cardStyles.sourceHeader}>
        <View style={cardStyles.kindMark} accessible={false}>
          <Text style={cardStyles.kindMarkText}>
            {source.kind === "url" ? "链" : "文"}
          </Text>
        </View>
        <View style={cardStyles.sourceTitle}>
          <View style={cardStyles.titleLine}>
            <Text style={[styles.heading, cardStyles.title]}>
              {source.name}
            </Text>
            <Text style={cardStyles.kindLabel}>
              {source.kind === "url" ? "链接" : "文件"}
            </Text>
            {!source.enabled && (
              <Text style={[cardStyles.kindLabel, cardStyles.disabledLabel]}>
                已停用
              </Text>
            )}
          </View>
          <Text style={styles.muted}>
            {source.channelCount} 个频道 · {source.favoriteCount} 个收藏
          </Text>
        </View>
      </View>
      <View style={cardStyles.updateLine}>
        <Text style={styles.caption}>
          上次更新 {formatUpdateTime(source.lastSuccessAt)}
        </Text>
        <View
          style={[
            cardStyles.statusDot,
            !source.enabled
              ? cardStyles.statusDotDisabled
              : source.lastErrorCategory && cardStyles.statusDotWarn,
          ]}
        />
        <Text
          style={[
            styles.caption,
            source.enabled && source.lastErrorCategory && cardStyles.warnText,
          ]}
        >
          {!source.enabled
            ? "不参与频道与播放"
            : source.lastErrorCategory
              ? "需注意"
              : "已启用"}
        </Text>
      </View>
      {source.lastErrorCategory && (
        <View style={cardStyles.warningBox}>
          <Text style={cardStyles.warnText}>
            上次刷新未完成，旧频道已保留。
          </Text>
        </View>
      )}
      {running && (
        <View style={cardStyles.progressBox} accessibilityLiveRegion="polite">
          <View style={cardStyles.progressTextLine}>
            <Text style={styles.body}>
              {check.total === null
                ? "正在读取待检测频道…"
                : `正在检测可用性 ${check.done}/${check.total}`}
            </Text>
            {check.total !== null && check.total > 0 && (
              <Text style={styles.caption}>
                {Math.round((check.done / check.total) * 100)}%
              </Text>
            )}
          </View>
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
      {!running && resultText && (
        <View style={cardStyles.resultLine}>
          <Text style={styles.muted}>{resultText}</Text>
        </View>
      )}
      {lookupRunning && (
        <Text style={styles.body} accessibilityLiveRegion="polite">
          正在补全语言…
        </Text>
      )}
      {!lookupRunning && languageMessage && (
        <Text style={styles.muted}>{languageMessage}</Text>
      )}
      <View style={cardStyles.quickActions}>
        <Button
          compact
          label={source.kind === "file" ? "重新解析" : "刷新并预览"}
          accessibilityLabel={
            source.kind === "file" ? "重新解析 / 更换文件" : "刷新并预览"
          }
          secondary
          disabled={!source.enabled || saving || !!check || !!languageLookup}
          onPress={() => props.onRefresh(source)}
        />
        {running ? (
          <Button
            compact
            label="停止检测"
            secondary
            onPress={props.onStopCheck}
          />
        ) : (
          <Button
            compact
            label={summary ? "重新检测" : "检测可用性"}
            secondary
            disabled={
              !source.enabled || saving || !!check || !source.channelCount
            }
            onPress={() =>
              summary ? props.onCheck(source, true) : props.onCheck(source)
            }
          />
        )}
        {props.onLookupLanguages &&
          (lookupRunning ? (
            <Button
              compact
              label="停止补全语言"
              secondary
              onPress={() => props.onStopLanguageLookup?.()}
            />
          ) : (
            <Button
              compact
              label="补全语言"
              secondary
              disabled={
                !!languageLookup ||
                !!check ||
                !source.enabled ||
                saving ||
                !source.channelCount
              }
              onPress={() => props.onLookupLanguages?.(source)}
            />
          ))}
        <Button
          compact
          label={saving ? "正在保存" : source.enabled ? "停用" : "启用"}
          secondary
          disabled={saving || taskBusy || (!!check && !running)}
          onPress={() => props.onEnabledChange(source, !source.enabled)}
        />
        <Button
          compact
          label="改名"
          secondary
          disabled={saving}
          onPress={() => props.onRename(source)}
        />
        <Button
          compact
          label="删除"
          secondary
          danger
          disabled={saving}
          onPress={() => props.onRemove(source)}
        />
      </View>
    </View>
  );
}

/**
 * This session's sweep when there is one; otherwise what SQLite holds, so
 * the result survives leaving the manager and restarting the app.
 */
function checkResultText(source: Source, summary?: CheckSummary) {
  if (summary)
    return `${summary.stopped ? "已停止：" : ""}可访问 ${summary.ok} 个，不可达 ${summary.unreachable} 个`;
  if (source.lastCheckedAt === null) return null;
  return `上次检测 ${formatUpdateTime(source.lastCheckedAt)} · 可访问 ${source.reachableCount} 个，不可达 ${source.unreachableCount} 个`;
}

/** A stable, compact local timestamp without depending on locale data. */
function formatUpdateTime(timestamp: number) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const cardStyles = StyleSheet.create({
  sourceHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  sourceCard: {
    borderRadius: 14,
    padding: 14,
    gap: 9,
    backgroundColor: colors.surface,
  },
  sourceCardDisabled: { opacity: 0.78 },
  kindMark: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.raised,
  },
  kindMarkText: { ...type.heading, color: colors.accent },
  sourceTitle: { flex: 1, minWidth: 0, gap: 2 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flexShrink: 1 },
  kindLabel: {
    ...type.caption,
    color: colors.muted,
    backgroundColor: colors.raised,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  disabledLabel: { color: colors.text },
  updateLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: {
    width: 6,
    height: 6,
    marginLeft: "auto",
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  statusDotWarn: { backgroundColor: colors.warn },
  statusDotDisabled: { backgroundColor: colors.mutedFaint },
  warnText: { ...type.muted, color: colors.warn },
  warningBox: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: colors.raised,
  },
  progressBox: { gap: 8 },
  progressTextLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
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
  resultLine: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: colors.raised,
  },
  quickActions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
