import React, { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { channelMonogram } from "../../domain/channelLabels";
import { daysAgo } from "../../domain/timeAgo";
import type { Source } from "../../domain/types";
import { colors, sizes, styles, type } from "../../theme";
import type { CheckProgress, CheckSummary } from "./availability";
import { SourceActionSheet, type SheetAction } from "./SourceActionSheet";

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
 * One source in the manager, laid out like a settings row: a monogram, the
 * name with its counts underneath, and a switch to turn the source on or
 * off. Anything that needs attention gets a third line in the warning
 * colour. A footer carries the two everyday actions; the rest open from
 * "更多" as a bottom sheet.
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
  const checked = !!summary || typeof source.lastCheckedAt === "number";
  const unreachable = summary ? summary.unreachable : source.unreachableCount;
  const meta = [
    source.kind === "file" ? "本地文件" : "链接",
    // The list shows logical channels; several addresses can share one.
    source.addressCount > source.channelCount
      ? `${source.channelCount} 个频道，${source.addressCount} 个地址`
      : `${source.channelCount} 个频道`,
    updatedAgo(source.lastSuccessAt, now),
  ]
    .filter(Boolean)
    .join(" · ");
  // A stopped source has nothing to act on, so it gets no third line.
  const attention = !source.enabled
    ? ""
    : [
        // Checks run per address, not per channel.
        checked && unreachable > 0 ? `${unreachable} 个地址暂时无法连接` : "",
        summary?.stopped ? "测试已停止" : "",
        source.lastErrorCategory ? "上次刷新未完成，旧频道已保留" : "",
      ]
        .filter(Boolean)
        .join(" · ");
  const sheetActions: SheetAction[] = [
    ...(source.enabled && props.onLookupLanguages && !lookupRunning
      ? [
          {
            label: "补全语言",
            disabled:
              !!languageLookup || !!check || saving || !source.channelCount,
            onPress: () => props.onLookupLanguages?.(source),
          },
        ]
      : []),
    { label: "改名", disabled: saving, onPress: () => props.onRename(source) },
    {
      label: "删除",
      danger: true,
      disabled: saving,
      onPress: () => props.onRemove(source),
    },
  ];
  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.head}>
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={[cardStyles.badge, !source.enabled && cardStyles.dimmed]}
        >
          <Text style={cardStyles.monogram}>
            {channelMonogram(source.name)}
          </Text>
        </View>
        <View style={[cardStyles.text, !source.enabled && cardStyles.dimmed]}>
          <Text style={cardStyles.title} numberOfLines={1}>
            {source.name}
          </Text>
          <Text style={styles.caption}>{meta}</Text>
          {!!attention && (
            <Text style={[styles.caption, cardStyles.warnText]}>
              {attention}
            </Text>
          )}
        </View>
        <Switch
          accessibilityLabel={source.enabled ? "停用" : "启用"}
          accessibilityHint={saving ? "正在保存" : undefined}
          value={source.enabled}
          disabled={saving || running || lookupRunning}
          trackColor={{ true: colors.accent }}
          onValueChange={(enabled) => props.onEnabledChange(source, enabled)}
        />
      </View>
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
          <Text style={styles.caption}>
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
        <Text
          style={[styles.caption, cardStyles.note]}
          accessibilityLiveRegion="polite"
        >
          正在补全语言…
        </Text>
      )}
      {!lookupRunning && languageMessage && (
        <Text style={[styles.caption, cardStyles.note]}>{languageMessage}</Text>
      )}
      <View style={cardStyles.footer}>
        {source.enabled && (
          <>
            <FooterAction
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
              disabled={saving || !!check || !!languageLookup}
              onPress={() => props.onRefresh(source)}
            />
            {running ? (
              <FooterAction label="停止测试" onPress={props.onStopCheck} />
            ) : (
              <FooterAction
                label="测试连通"
                accessibilityLabel={checked ? "重新测试连通" : "测试连通"}
                disabled={saving || !!check || !source.channelCount}
                onPress={() =>
                  summary ? props.onCheck(source, true) : props.onCheck(source)
                }
              />
            )}
            {lookupRunning && (
              <FooterAction
                label="停止补全"
                accessibilityLabel="停止补全语言"
                onPress={() => props.onStopLanguageLookup?.()}
              />
            )}
          </>
        )}
        <View style={cardStyles.spacer} />
        <FooterAction
          label="更多"
          accessibilityLabel="更多操作"
          muted
          onPress={() => setMoreOpen(true)}
        />
      </View>
      <SourceActionSheet
        visible={moreOpen}
        title={source.name}
        actions={sheetActions}
        onClose={() => setMoreOpen(false)}
      />
    </View>
  );
}

/** A flat text action in the card footer. */
function FooterAction({
  label,
  accessibilityLabel,
  disabled = false,
  muted = false,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  /** Secondary (更多): drawn in the muted colour. */
  muted?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        cardStyles.footerAction,
        disabled && cardStyles.dimmed,
        pressed && cardStyles.pressed,
      ]}
    >
      <Text style={[cardStyles.footerText, muted && cardStyles.footerMuted]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** "今天更新", "昨天更新", "3 天前更新"; nothing for an unknown time. */
export function updatedAgo(timestamp: number, now: number) {
  const ago = daysAgo(timestamp, now);
  return ago ? `${ago}更新` : "";
}

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 14,
    paddingBottom: 12,
    paddingLeft: 14,
    paddingRight: 12,
  },
  badge: {
    width: sizes.logo,
    height: sizes.logo,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.raised,
  },
  monogram: { ...type.heading, color: colors.accent },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...type.rowTitle, color: colors.text },
  dimmed: { opacity: 0.45 },
  warnText: { color: colors.warn },
  note: { paddingHorizontal: 14, paddingBottom: 10 },
  progressLine: { gap: 6, paddingHorizontal: 14, paddingBottom: 12 },
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
  footer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  footerAction: {
    minHeight: sizes.touch,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  footerText: { ...type.chip, color: colors.accent, fontWeight: "600" },
  footerMuted: { color: colors.muted },
  spacer: { flex: 1 },
  pressed: { opacity: 0.7 },
});
