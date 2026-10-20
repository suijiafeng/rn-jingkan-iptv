import React, { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
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
  onRename: (source: Source) => void;
  onRemove: (source: Source) => void;
  onEnabledChange: (source: Source, enabled: boolean) => void;
  onCheck: (source: Source, force?: boolean) => void;
  onStopCheck: () => void;
}

/**
 * One source in the manager: one line with the name on the left and its
 * channel count and update time on the right, and a single line in the
 * warning colour only when something needs attention. One footer row holds every
 * control: 测试连通, 编辑 (name and link) and 删除 (in the error colour)
 * on the left, the on/off switch at the right end.
 */
export function SourceCard({
  source,
  check,
  summary,
  saving,
  ...props
}: Props) {
  // Day granularity: the time the manager opened is precise enough.
  const [now] = useState(() => Date.now());
  const running = check?.sourceId === source.id;
  const checked = !!summary || typeof source.lastCheckedAt === "number";
  const unreachable = summary ? summary.unreachable : source.unreachableCount;
  // Channels as the list shows them; addresses only come up when some
  // of them cannot be reached.
  const meta = [
    `${source.channelCount} 个频道`,
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
  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.head}>
        <View style={[cardStyles.text, !source.enabled && cardStyles.dimmed]}>
          {/* Name on the left; its counts fill the right of the same
              line. A long name ends in an ellipsis, the counts stay. */}
          <View style={cardStyles.titleLine}>
            <Text style={cardStyles.title} numberOfLines={1}>
              {source.name}
            </Text>
            <Text style={[styles.caption, cardStyles.meta]} numberOfLines={1}>
              {meta}
            </Text>
          </View>
          {!!attention && (
            <Text
              style={[styles.caption, cardStyles.warnText]}
              numberOfLines={1}
            >
              {attention}
            </Text>
          )}
        </View>
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
      {/* Every card shows the same four actions; one that cannot be used
          right now is greyed out in place, not hidden. */}
      <View style={cardStyles.footer}>
        {running ? (
          <FooterAction label="停止测试" onPress={props.onStopCheck} />
        ) : (
          <FooterAction
            label="测试连通"
            accessibilityLabel={checked ? "重新测试连通" : "测试连通"}
            disabled={
              !source.enabled || saving || !!check || !source.channelCount
            }
            onPress={() =>
              summary ? props.onCheck(source, true) : props.onCheck(source)
            }
          />
        )}
        <FooterAction
          label="编辑"
          disabled={saving}
          onPress={() => props.onRename(source)}
        />
        <FooterAction
          label="删除"
          danger
          disabled={saving}
          onPress={() => props.onRemove(source)}
        />
        <View style={cardStyles.spacer} />
        {/* On/off sits at the row's end, leaving the text above the
            card's full width. */}
        <Switch
          style={cardStyles.switch}
          accessibilityLabel={source.enabled ? "停用" : "启用"}
          accessibilityHint={saving ? "正在保存" : undefined}
          value={source.enabled}
          disabled={saving || running}
          trackColor={{ true: colors.accent }}
          onValueChange={(enabled) => props.onEnabledChange(source, enabled)}
        />
      </View>
    </View>
  );
}

/** A flat text action in the card footer. */
function FooterAction({
  label,
  accessibilityLabel,
  disabled = false,
  danger = false,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  /** Destructive (删除): drawn in the error colour. */
  danger?: boolean;
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
      <Text style={[cardStyles.footerText, danger && cardStyles.danger]}>
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
  text: { flex: 1, minWidth: 0, gap: 2 },
  spacer: { flex: 1 },
  switch: { marginRight: 8 },
  titleLine: { flexDirection: "row", alignItems: "baseline", gap: 12 },
  title: { ...type.rowTitle, color: colors.text, flex: 1, minWidth: 0 },
  meta: { flexShrink: 0 },
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
  danger: { color: colors.bad },
  pressed: { opacity: 0.7 },
});
