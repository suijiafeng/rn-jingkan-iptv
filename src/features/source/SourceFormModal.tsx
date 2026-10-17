import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Heading, Notice } from "../../components/ui";
import { displayGroups } from "../../domain/channelLabels";
import { MAX_MIB } from "../../domain/m3u";
import { IMPORT_ISSUE_LABELS, ImportIssueReason } from "../../domain/types";
import { colors, styles } from "../../theme";
import type { SourceFormState } from "./form";

interface Props {
  form: SourceFormState | null;
  busy: boolean;
  error: string;
  onUpdate: (patch: Partial<SourceFormState>) => void;
  onChooseFile: () => void;
  onPreview: () => void;
  onSave: () => void;
  onClose: () => void;
}

/** Add / refresh playlist form: input → preview → explicit save. */
export function SourceFormModal({
  form,
  busy,
  error,
  onUpdate,
  onChooseFile,
  onPreview,
  onSave,
  onClose,
}: Props) {
  return (
    <Modal visible={!!form} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            {form && (
              <>
                <Heading
                  title={
                    form.preview
                      ? "确认导入"
                      : form.refresh
                        ? "刷新节目单"
                        : "添加节目单"
                  }
                  subtitle={
                    form.preview
                      ? "确认后才保存，已有资料不会提前改动"
                      : "仅使用你信任且有权访问的来源"
                  }
                />
                {error && (
                  <Notice
                    title={error}
                    error
                    body="你的输入已保留。没有提前修改频道。"
                  />
                )}
                {!form.preview ? (
                  <>
                    <Text style={styles.body}>来源名称</Text>
                    <TextInput
                      accessibilityLabel="来源名称"
                      editable={!busy && !form.refresh}
                      style={styles.input}
                      value={form.name}
                      maxLength={100}
                      placeholder="可留空，使用主机或文件名"
                      placeholderTextColor={colors.muted}
                      onChangeText={(v) => onUpdate({ name: v })}
                    />
                    {!form.refresh && (
                      <View style={styles.row}>
                        <Button
                          style={{ flex: 1 }}
                          secondary={form.kind !== "url"}
                          label="链接"
                          disabled={busy}
                          onPress={() => onUpdate({ kind: "url" })}
                        />
                        <Button
                          style={{ flex: 1 }}
                          secondary={form.kind !== "file"}
                          label="文件"
                          disabled={busy}
                          onPress={() => onUpdate({ kind: "file" })}
                        />
                      </View>
                    )}
                    {form.kind === "url" ? (
                      <>
                        <Text style={styles.body}>节目单链接</Text>
                        <TextInput
                          accessibilityLabel="节目单链接"
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="url"
                          editable={!busy && !form.refresh}
                          style={styles.input}
                          value={form.url}
                          onChangeText={(v) => onUpdate({ url: v })}
                          placeholder="https://example.com/channels.m3u"
                          placeholderTextColor={colors.muted}
                        />
                      </>
                    ) : (
                      <>
                        <Notice
                          title={form.fileName || "选择 M3U 文件"}
                          body={`使用系统文件选择器，仅读取你选中的文件。上限 ${MAX_MIB} MiB，UTF-8 编码。`}
                        />
                        <Button
                          label="选择 / 更换文件"
                          secondary
                          disabled={busy}
                          onPress={onChooseFile}
                        />
                      </>
                    )}
                    <Notice
                      title="只导入你信任的来源"
                      body="来源服务器会收到 IP 地址与请求。HTTP 可能泄露或被篡改；首次联网前需要明确同意。"
                    />
                    <Button
                      label={busy ? "正在读取与解析…" : "解析并预览"}
                      disabled={busy}
                      onPress={onPreview}
                    />
                  </>
                ) : (
                  <>
                    <Notice
                      title={`${form.preview.stats.valid} 个可导入频道`}
                      body={`${form.preview.stats.duplicates} 条重复 · ${form.preview.stats.ignored} 条忽略 · ${form.preview.stats.http} 个 HTTP 频道`}
                    />
                    {Object.entries(form.preview.issueCounts).map(
                      ([reason, count]) => (
                        <Text key={reason} style={styles.muted}>
                          {IMPORT_ISSUE_LABELS[reason as ImportIssueReason]}：
                          {count}
                        </Text>
                      ),
                    )}
                    {form.preview.channels.slice(0, 5).map((c) => (
                      <Card key={c.identityKey}>
                        <Text style={styles.heading}>{c.name}</Text>
                        <Text style={styles.muted}>
                          {displayGroups(c.groupName)}
                        </Text>
                      </Card>
                    ))}
                    <Text style={styles.muted}>
                      仅展示前 5 项。导入成功不代表每个频道可播放。
                    </Text>
                    <Button
                      label={
                        busy
                          ? "正在保存…"
                          : `确认保存 ${form.preview.stats.valid} 个频道`
                      }
                      disabled={busy || !form.preview.stats.valid}
                      onPress={onSave}
                    />
                    <Button
                      label="返回修改"
                      secondary
                      disabled={busy}
                      onPress={() => onUpdate({ preview: null })}
                    />
                  </>
                )}
                {busy && <ActivityIndicator color={colors.accent} />}
                <Button
                  label="取消并返回"
                  secondary
                  disabled={busy && !!form.preview}
                  onPress={onClose}
                />
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
