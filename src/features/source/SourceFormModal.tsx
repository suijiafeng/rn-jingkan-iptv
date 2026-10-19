import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackBar, Button, Card, Heading, Notice } from "../../components/ui";
import { displayGroups } from "../../domain/channelLabels";
import { IMPORT_ISSUE_LABELS, ImportIssueReason } from "../../domain/types";
import { colors, sizes, styles, type } from "../../theme";
import type { SourceFormState } from "./form";

interface Props {
  form: SourceFormState | null;
  busy: boolean;
  error: string;
  onUpdate: (patch: Partial<SourceFormState>) => void;
  onChooseFile: () => void;
  onPreview: () => void;
  onSave: () => void;
  /** One level back: preview → editing; editing → leave (asks if unsaved). */
  onBack: () => void;
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
  onBack,
}: Props) {
  return (
    <Modal visible={!!form} animationType="slide" onRequestClose={onBack}>
      <SafeAreaView style={styles.screen}>
        {/* Preview steps back to editing; editing leaves the form. */}
        {form && <BackBar onBack={onBack} />}
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
                      ? `${form.preview.stats.valid} 个频道`
                      : form.refresh
                        ? "刷新节目单"
                        : "添加节目单"
                  }
                />
                {error && <Notice title={error} error />}
                {!form.preview ? (
                  <>
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
                      <TextInput
                        accessibilityLabel="节目单链接"
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        editable={!busy && !form.refresh}
                        style={styles.input}
                        value={form.url}
                        onChangeText={(url) => onUpdate({ url })}
                        placeholder="https://example.com/channels.m3u"
                        placeholderTextColor={colors.muted}
                      />
                    ) : (
                      // Encoding and size limits are only worth a word when
                      // a file breaks them; the error says so then.
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          form.fileName
                            ? `更换文件，当前 ${form.fileName}`
                            : "选择节目单文件"
                        }
                        disabled={busy}
                        onPress={onChooseFile}
                        style={({ pressed }) => [
                          formStyles.fileBox,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Text style={styles.heading} numberOfLines={1}>
                          {form.fileName || "选择文件"}
                        </Text>
                        <Text style={styles.muted}>
                          {form.fileName ? "点按更换" : "M3U / TXT"}
                        </Text>
                      </Pressable>
                    )}
                    <TextInput
                      accessibilityLabel="来源名称"
                      editable={!busy && !form.refresh}
                      style={styles.input}
                      value={form.name}
                      maxLength={100}
                      placeholder="名称（可选）"
                      placeholderTextColor={colors.muted}
                      onChangeText={(name) => onUpdate({ name })}
                    />
                    <Button
                      label={busy ? "正在读取…" : "预览"}
                      disabled={busy}
                      onPress={onPreview}
                    />
                  </>
                ) : (
                  <ImportPreviewBody
                    preview={form.preview}
                    busy={busy}
                    onSave={onSave}
                    onBack={() => onUpdate({ preview: null })}
                  />
                )}
                {busy && <ActivityIndicator color={colors.accent} />}
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

/**
 * The parsed playlist before saving: the count is the title, risk (HTTP) in
 * the warning colour, and everything that was skipped behind one line.
 */
function ImportPreviewBody({
  preview,
  busy,
  onSave,
  onBack,
}: {
  preview: NonNullable<SourceFormState["preview"]>;
  busy: boolean;
  onSave: () => void;
  onBack: () => void;
}) {
  const [skippedOpen, setSkippedOpen] = useState(false);
  const { stats } = preview;
  const skipped = stats.duplicates + stats.ignored;
  const shown = preview.channels.slice(0, 5);
  return (
    <>
      {stats.http > 0 && (
        <Text style={formStyles.warnText}>
          {stats.http} 个频道未加密（HTTP）
        </Text>
      )}
      {skipped > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: skippedOpen }}
          onPress={() => setSkippedOpen((open) => !open)}
          style={formStyles.skippedToggle}
        >
          <Text style={styles.muted}>{skipped} 条未导入</Text>
          <Text style={styles.muted}>{skippedOpen ? "收起" : "›"}</Text>
        </Pressable>
      )}
      {skippedOpen &&
        Object.entries(preview.issueCounts).map(([reason, count]) => (
          <Text key={reason} style={styles.muted}>
            {IMPORT_ISSUE_LABELS[reason as ImportIssueReason]}：{count}
          </Text>
        ))}
      {shown.map((channel) => (
        <Card key={channel.identityKey}>
          <Text style={styles.heading}>{channel.name}</Text>
          <Text style={styles.muted}>{displayGroups(channel.groupName)}</Text>
        </Card>
      ))}
      {stats.valid > shown.length && (
        <Text style={styles.muted}>… 还有 {stats.valid - shown.length} 个</Text>
      )}
      <Button
        label={busy ? "正在保存…" : "导入"}
        accessibilityLabel={`导入 ${stats.valid} 个频道`}
        disabled={busy || !stats.valid}
        onPress={onSave}
      />
      <Button label="返回修改" secondary disabled={busy} onPress={onBack} />
    </>
  );
}

const formStyles = StyleSheet.create({
  fileBox: {
    minHeight: 88,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 16,
  },
  warnText: { ...type.body, color: colors.warn },
  skippedToggle: {
    minHeight: sizes.touch,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
