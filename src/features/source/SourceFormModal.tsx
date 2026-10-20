import React from "react";
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
import { BackBar, Button, Heading, Notice } from "../../components/ui";
import { colors, styles } from "../../theme";
import type { SourceFormState } from "./form";
import { ImportPreviewBody } from "./ImportPreview";

interface Props {
  form: SourceFormState | null;
  busy: boolean;
  error: string;
  onUpdate: (patch: Partial<SourceFormState>) => void;
  /** The preview's 自动补全语言 switch. */
  onFillLanguages: (on: boolean) => void;
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
  onFillLanguages,
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
          {form?.preview ? (
            // Its own layout: the full channel list scrolls lazily, which a
            // list nested in the form's ScrollView could not.
            <ImportPreviewBody
              preview={form.preview}
              header={
                <>
                  <Heading title={`${form.preview.stats.valid} 个频道`} />
                  {error && <Notice title={error} error />}
                </>
              }
              busy={busy}
              fillLanguages={form.fillLanguages}
              onFillLanguages={onFillLanguages}
              onSave={onSave}
              onBack={() => onUpdate({ preview: null })}
            />
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
            >
              {form && (
                <>
                  <Heading title={form.refresh ? "刷新节目单" : "添加节目单"} />
                  {error && <Notice title={error} error />}
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
                          // Straight to the picker: the box underneath is
                          // only for changing a file already chosen.
                          onPress={() => {
                            onUpdate({ kind: "file" });
                            if (!form.fileName) onChooseFile();
                          }}
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
                  {busy && <ActivityIndicator color={colors.accent} />}
                </>
              )}
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
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
});
