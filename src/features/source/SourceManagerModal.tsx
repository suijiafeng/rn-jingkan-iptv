import React from "react";
import { Modal, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Heading, Notice } from "../../components/ui";
import type { Source, SourceKind } from "../../domain/types";
import { colors, styles } from "../../theme";

export interface CheckProgress {
  sourceId: string;
  done: number;
  total: number;
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
  onClose: () => void;
  onAdd: (kind: SourceKind) => void;
  onRefresh: (source: Source) => void;
  onRename: (source: Source) => void;
  onRemove: (source: Source) => void;
  onCheck: (source: Source) => void;
  onStopCheck: () => void;
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
          <Button label="添加节目单" onPress={() => props.onAdd("url")} />
          <Button
            label="从文件导入"
            secondary
            onPress={() => props.onAdd("file")}
          />
          {props.sources.map((s) => {
            const running = check?.sourceId === s.id;
            const summary = props.summaries[s.id];
            return (
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
                {running && (
                  <Text style={styles.body} accessibilityLiveRegion="polite">
                    正在检测可用性 {check.done}/{check.total}
                  </Text>
                )}
                {!running && summary && (
                  <Text style={styles.muted}>
                    {summary.stopped ? "检测已停止。" : "检测完成。"}
                    可访问 {summary.ok} 个，不可达 {summary.unreachable}{" "}
                    个。可访问只代表服务器有响应，不保证一定能播放。
                  </Text>
                )}
                <Button
                  label={
                    s.kind === "file" ? "重新解析 / 更换文件" : "刷新并预览"
                  }
                  secondary
                  disabled={!!check}
                  onPress={() => props.onRefresh(s)}
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
                    disabled={!!check || !s.channelCount}
                    onPress={() => props.onCheck(s)}
                  />
                )}
                <View style={styles.row}>
                  <Button
                    label="改名"
                    secondary
                    style={{ flex: 1 }}
                    onPress={() => props.onRename(s)}
                  />
                  <Button
                    label="删除"
                    secondary
                    danger
                    style={{ flex: 1 }}
                    onPress={() => props.onRemove(s)}
                  />
                </View>
              </Card>
            );
          })}
          <Notice
            title="关于可用性检测"
            body="只在你点击时进行：每个频道发一次很小的请求（最多 1 KiB），同时最多 4 个。结果只说明服务器当时是否有响应，地区限制、节目暂停或格式不支持仍可能无法播放。"
          />
          <Button secondary label="返回" onPress={props.onClose} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

interface RenameProps {
  source: Source | null;
  text: string;
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
