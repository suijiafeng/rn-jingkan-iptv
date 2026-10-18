import React from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Heading, Notice } from "../../components/ui";
import type { Source, SourceKind } from "../../domain/types";
import { colors, styles, type } from "../../theme";

export interface CheckProgress {
  sourceId: string;
  done: number;
  /** Null while the repository is loading the complete, ungrouped target set. */
  total: number | null;
}
export interface CheckSummary {
  ok: number;
  unreachable: number;
  stopped: boolean;
}

interface ManagerProps {
  visible: boolean;
  sources: Source[];
  check: CheckProgress | null;
  summaries: Record<string, CheckSummary>;
  error?: string;
  onDismissError?: () => void;
  onClose: () => void;
  onAdd: (kind: SourceKind) => void;
  onRefresh: (source: Source) => void;
  onRename: (source: Source) => void;
  onRemove: (source: Source) => void;
  sourceSaving?: string | null;
  onEnabledChange: (source: Source, enabled: boolean) => void;
  onCheck: (source: Source, force?: boolean) => void;
  onStopCheck: () => void;
  /** Source whose languages are being looked up in the iptv-org database. */
  languageLookup?: string | null;
  languageMessages?: Record<string, string>;
  onLookupLanguages?: (source: Source) => void;
  onStopLanguageLookup?: () => void;
}

export function SourceManagerModal(props: ManagerProps) {
  const { check } = props;
  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      onRequestClose={props.onClose}
    >
      <SafeAreaView style={styles.screen}>
        <ScrollView
          contentContainerStyle={[styles.content, managerStyles.content]}
        >
          <View style={managerStyles.header}>
            <View style={managerStyles.headerText}>
              <Heading
                title="管理节目来源"
                subtitle={`${props.sources.length} 份节目单 · 只在你操作时联网`}
              />
            </View>
            <Button compact secondary label="完成" onPress={props.onClose} />
          </View>
          {!!props.error && (
            <>
              <Notice title={props.error} error />
              {props.onDismissError && (
                <Button
                  label="关闭提示"
                  secondary
                  onPress={props.onDismissError}
                />
              )}
            </>
          )}
          <View style={managerStyles.addActions}>
            <Button
              style={managerStyles.addButton}
              label="添加链接"
              onPress={() => props.onAdd("url")}
            />
            <Button
              style={managerStyles.addButton}
              label="导入文件"
              secondary
              onPress={() => props.onAdd("file")}
            />
          </View>
          <Text style={styles.muted}>
            可用性按播放地址全局共用，6 小时内复用结果；“重新检测”才会强制更新。统计按去重后的地址计数，可访问不代表一定能播放。
          </Text>
          {props.sources.length === 0 && (
            <View style={managerStyles.emptyCard}>
              <View style={managerStyles.emptyMark} accessible={false}>
                <Text style={managerStyles.emptyMarkText}>＋</Text>
              </View>
              <Text style={styles.heading}>还没有节目来源</Text>
              <Text style={[styles.muted, managerStyles.centerText]}>
                添加一个节目单链接，或从本机导入 M3U、TXT
                文件。不会自动添加远程来源。
              </Text>
            </View>
          )}
          {props.sources.map((source) => {
            const running = check?.sourceId === source.id;
            const summary = props.summaries[source.id];
            const lookupRunning = props.languageLookup === source.id;
            const saving = props.sourceSaving === source.id;
            const taskBusy = running || lookupRunning;
            return (
              <View
                key={source.id}
                style={[
                  managerStyles.sourceCard,
                  !source.enabled && managerStyles.sourceCardDisabled,
                ]}
              >
                <View style={managerStyles.sourceHeader}>
                  <View style={managerStyles.kindMark} accessible={false}>
                    <Text style={managerStyles.kindMarkText}>
                      {source.kind === "url" ? "链" : "文"}
                    </Text>
                  </View>
                  <View style={managerStyles.sourceTitle}>
                    <View style={managerStyles.titleLine}>
                      <Text style={[styles.heading, managerStyles.title]}>
                        {source.name}
                      </Text>
                      <Text style={managerStyles.kindLabel}>
                        {source.kind === "url" ? "链接" : "文件"}
                      </Text>
                      {!source.enabled && (
                        <Text
                          style={[
                            managerStyles.kindLabel,
                            managerStyles.disabledLabel,
                          ]}
                        >
                          已停用
                        </Text>
                      )}
                    </View>
                    <Text style={styles.muted}>
                      {source.channelCount} 个频道 · {source.favoriteCount}{" "}
                      个收藏
                    </Text>
                  </View>
                </View>
                <View style={managerStyles.updateLine}>
                  <Text style={styles.caption}>
                    上次更新 {formatUpdateTime(source.lastSuccessAt)}
                  </Text>
                  <View
                    style={[
                      managerStyles.statusDot,
                      !source.enabled
                        ? managerStyles.statusDotDisabled
                        : source.lastErrorCategory &&
                          managerStyles.statusDotWarn,
                    ]}
                  />
                  <Text
                    style={[
                      styles.caption,
                      source.enabled &&
                        source.lastErrorCategory &&
                        managerStyles.warnText,
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
                  <View style={managerStyles.warningBox}>
                    <Text style={managerStyles.warnText}>
                      上次刷新未完成，旧频道已保留。
                    </Text>
                  </View>
                )}
                {running && (
                  <View
                    style={managerStyles.progressBox}
                    accessibilityLiveRegion="polite"
                  >
                    <View style={managerStyles.progressTextLine}>
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
                    <View style={managerStyles.progressTrack}>
                      <View
                        style={[
                          managerStyles.progressFill,
                          {
                            width: `${
                              check.total
                                ? Math.min(
                                    100,
                                    (check.done / check.total) * 100,
                                  )
                                : 12
                            }%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                )}
                {!running && summary && (
                  <View style={managerStyles.resultLine}>
                    <Text style={styles.muted}>
                      {summary.stopped ? "已停止：" : ""}可访问 {summary.ok}{" "}
                      个，不可达 {summary.unreachable} 个
                    </Text>
                  </View>
                )}
                {lookupRunning && (
                  <Text style={styles.body} accessibilityLiveRegion="polite">
                    正在补全语言…
                  </Text>
                )}
                {!lookupRunning && props.languageMessages?.[source.id] && (
                  <Text style={styles.muted}>
                    {props.languageMessages[source.id]}
                  </Text>
                )}
                <View style={managerStyles.quickActions}>
                  <Button
                    compact
                    label={source.kind === "file" ? "重新解析" : "刷新并预览"}
                    accessibilityLabel={
                      source.kind === "file"
                        ? "重新解析 / 更换文件"
                        : "刷新并预览"
                    }
                    secondary
                    disabled={
                      !source.enabled ||
                      saving ||
                      !!check ||
                      !!props.languageLookup
                    }
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
                        !source.enabled ||
                        saving ||
                        !!check ||
                        !source.channelCount
                      }
                      onPress={() =>
                        summary
                          ? props.onCheck(source, true)
                          : props.onCheck(source)
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
                          !!props.languageLookup ||
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
                    label={
                      saving ? "正在保存" : source.enabled ? "停用" : "启用"
                    }
                    secondary
                    disabled={saving || taskBusy || (!!check && !running)}
                    onPress={() =>
                      props.onEnabledChange(source, !source.enabled)
                    }
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
          })}
          <Button secondary label="返回" onPress={props.onClose} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
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

interface RenameProps {
  source: Source | null;
  text: string;
  error?: string;
  onDismissError?: () => void;
  onChangeText: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function RenameSourceModal(props: RenameProps) {
  return (
    <Modal
      visible={!!props.source}
      animationType="slide"
      onRequestClose={props.onCancel}
    >
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <Heading title="来源改名" />
          {!!props.error && (
            <>
              <Notice title={props.error} error />
              {props.onDismissError && (
                <Button
                  label="关闭提示"
                  secondary
                  onPress={props.onDismissError}
                />
              )}
            </>
          )}
          <TextInput
            accessibilityLabel="来源名称"
            style={styles.input}
            value={props.text}
            onChangeText={props.onChangeText}
            maxLength={100}
          />
          <Button
            label="保存名称"
            disabled={!props.text.trim()}
            onPress={props.onSave}
          />
          <Button label="取消" secondary onPress={props.onCancel} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const managerStyles = StyleSheet.create({
  content: { gap: 12 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  headerText: { flex: 1, minWidth: 0 },
  addActions: { flexDirection: "row", gap: 10 },
  addButton: { flex: 1 },
  emptyCard: {
    minHeight: 220,
    borderRadius: 16,
    padding: 28,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.surface,
  },
  emptyMark: {
    width: 48,
    height: 48,
    marginBottom: 4,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.raised,
  },
  emptyMarkText: { ...type.title, color: colors.accent },
  centerText: { maxWidth: 280, textAlign: "center" },
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
