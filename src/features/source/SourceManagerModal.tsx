import React from "react";
import { Modal, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Heading, Notice } from "../../components/ui";
import type { Source, SourceKind } from "../../domain/types";
import { colors, styles } from "../../theme";

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
  onCheck: (source: Source) => void;
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
        <ScrollView contentContainerStyle={styles.content}>
          <Heading
            title="管理节目来源"
            subtitle={`${props.sources.length} 份节目单 · 手动刷新，不自动联网`}
          />
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
          <Button label="添加节目单" onPress={() => props.onAdd("url")} />
          <Button
            label="从文件导入"
            secondary
            onPress={() => props.onAdd("file")}
          />
          {props.sources.map((source) => {
            const running = check?.sourceId === source.id;
            const summary = props.summaries[source.id];
            return (
              <Card key={source.id}>
                <Text style={styles.heading}>{source.name}</Text>
                <Text style={styles.muted}>
                  {source.channelCount} 个频道 · {source.favoriteCount} 个收藏
                  {String.fromCharCode(10)}上次更新{" "}
                  {new Date(source.lastSuccessAt).toLocaleString()}
                </Text>
                {source.lastErrorCategory && (
                  <Text style={{ color: colors.warn }}>
                    上次刷新未完成，旧频道已保留。
                  </Text>
                )}
                {running && (
                  <Text style={styles.body} accessibilityLiveRegion="polite">
                    {check.total === null
                      ? "正在读取待检测频道…"
                      : `正在检测可用性 ${check.done}/${check.total}`}
                  </Text>
                )}
                {!running && summary && (
                  <Text style={styles.muted}>
                    {summary.stopped ? "已停止：" : ""}可访问 {summary.ok}{" "}
                    个，不可达 {summary.unreachable} 个
                  </Text>
                )}
                <Button
                  label={
                    source.kind === "file"
                      ? "重新解析 / 更换文件"
                      : "刷新并预览"
                  }
                  secondary
                  disabled={!!check}
                  onPress={() => props.onRefresh(source)}
                />
                {running ? (
                  <Button
                    label="停止检测"
                    secondary
                    onPress={props.onStopCheck}
                  />
                ) : (
                  <Button
                    label="检测可用性"
                    secondary
                    disabled={!!check || !source.channelCount}
                    onPress={() => props.onCheck(source)}
                  />
                )}
                {props.languageLookup === source.id && (
                  <Text style={styles.body} accessibilityLiveRegion="polite">
                    正在补全语言…
                  </Text>
                )}
                {props.languageLookup !== source.id &&
                  props.languageMessages?.[source.id] && (
                    <Text style={styles.muted}>
                      {props.languageMessages[source.id]}
                    </Text>
                  )}
                {props.onLookupLanguages &&
                  (props.languageLookup === source.id ? (
                    <Button
                      label="停止补全语言"
                      secondary
                      onPress={() => props.onStopLanguageLookup?.()}
                    />
                  ) : (
                    <Button
                      label="补全语言"
                      secondary
                      disabled={
                        !!props.languageLookup ||
                        !!check ||
                        !source.channelCount
                      }
                      onPress={() => props.onLookupLanguages?.(source)}
                    />
                  ))}
                <View style={styles.row}>
                  <Button
                    label="改名"
                    secondary
                    style={{ flex: 1 }}
                    onPress={() => props.onRename(source)}
                  />
                  <Button
                    label="删除"
                    secondary
                    danger
                    style={{ flex: 1 }}
                    onPress={() => props.onRemove(source)}
                  />
                </View>
              </Card>
            );
          })}
          <Button secondary label="返回" onPress={props.onClose} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
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
