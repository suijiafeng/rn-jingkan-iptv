import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/ui";
import { displayGroups } from "../../domain/channelLabels";
import {
  IMPORT_ISSUE_LABELS,
  type ImportIssueReason,
  type ParsedChannel,
} from "../../domain/types";
import { colors, sizes, styles, type } from "../../theme";
import type { SourceFormState } from "./form";

/** Fixed row height, so a 20,000-entry list scrolls without measuring. */
const ROW_HEIGHT = 56;

/**
 * The parsed playlist before saving. Every channel is listed and scrolls,
 * rendered lazily; the counts and warnings head the list, and 导入 stays
 * pinned at the bottom so it never needs scrolling to.
 */
export function ImportPreviewBody({
  preview,
  header,
  busy,
  onSave,
  onBack,
}: {
  preview: NonNullable<SourceFormState["preview"]>;
  /** Page title and any error, shown above the counts. */
  header: React.ReactNode;
  busy: boolean;
  onSave: () => void;
  onBack: () => void;
}) {
  const [skippedOpen, setSkippedOpen] = useState(false);
  const { stats } = preview;
  const skipped = stats.duplicates + stats.ignored;
  return (
    <View style={previewStyles.root}>
      <FlatList
        testID="import-preview-list"
        data={preview.channels}
        keyExtractor={(channel) => channel.identityKey}
        renderItem={({ item }) => <PreviewRow channel={item} />}
        getItemLayout={(_rows, index) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * index,
          index,
        })}
        initialNumToRender={20}
        windowSize={11}
        contentContainerStyle={previewStyles.content}
        ListHeaderComponent={
          <View style={previewStyles.header}>
            {header}
            {stats.http > 0 && (
              <Text style={previewStyles.warnText}>
                {stats.http} 个频道未加密（HTTP）
              </Text>
            )}
            {skipped > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: skippedOpen }}
                onPress={() => setSkippedOpen((open) => !open)}
                style={previewStyles.skippedToggle}
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
          </View>
        }
      />
      <View style={previewStyles.footer}>
        <Button
          style={previewStyles.footerButton}
          label="返回修改"
          secondary
          disabled={busy}
          onPress={onBack}
        />
        <Button
          style={previewStyles.footerButton}
          label={busy ? "正在保存…" : "导入"}
          accessibilityLabel={`导入 ${stats.valid} 个频道`}
          disabled={busy || !stats.valid}
          onPress={onSave}
        />
      </View>
    </View>
  );
}

function PreviewRow({ channel }: { channel: ParsedChannel }) {
  return (
    <View style={previewStyles.row}>
      <View style={previewStyles.titleLine}>
        <Text style={previewStyles.name} numberOfLines={1}>
          {channel.name}
        </Text>
        {channel.qualityLabel && (
          <Text style={previewStyles.tag}>{channel.qualityLabel}</Text>
        )}
      </View>
      <Text style={styles.caption} numberOfLines={1}>
        {displayGroups(channel.groupName)}
      </Text>
    </View>
  );
}

const previewStyles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 16 },
  header: { gap: 12, paddingTop: 20, paddingBottom: 8 },
  warnText: { ...type.body, color: colors.warn },
  skippedToggle: {
    minHeight: sizes.touch,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  row: {
    height: ROW_HEIGHT,
    justifyContent: "center",
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { ...type.rowTitle, color: colors.text, flexShrink: 1 },
  tag: {
    ...type.caption,
    color: colors.muted,
    backgroundColor: colors.raised,
    borderRadius: 6,
    paddingHorizontal: 6,
    overflow: "hidden",
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
  footerButton: { flex: 1 },
});
