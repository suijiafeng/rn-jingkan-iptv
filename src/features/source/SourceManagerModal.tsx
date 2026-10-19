import React from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackBar, Button, ErrorNotice, Heading } from "../../components/ui";
import type { Source, SourceKind } from "../../domain/types";
import { colors, styles, type } from "../../theme";
import type { CheckProgress, CheckSummary } from "./availability";
import { SourceCard } from "./SourceCard";

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
        <BackBar onBack={props.onClose} />
        <ScrollView
          contentContainerStyle={[styles.content, managerStyles.content]}
        >
          <Heading title="节目来源" />
          <ErrorNotice message={props.error} onDismiss={props.onDismissError} />
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
          {props.sources.length === 0 && (
            <View style={managerStyles.emptyCard}>
              <View style={managerStyles.emptyMark} accessible={false}>
                <Text style={managerStyles.emptyMarkText}>＋</Text>
              </View>
              <Text style={styles.heading}>还没有节目来源</Text>
            </View>
          )}
          {props.sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              check={check}
              summary={props.summaries[source.id]}
              saving={props.sourceSaving === source.id}
              languageLookup={props.languageLookup ?? null}
              languageMessage={props.languageMessages?.[source.id]}
              onRefresh={props.onRefresh}
              onRename={props.onRename}
              onRemove={props.onRemove}
              onEnabledChange={props.onEnabledChange}
              onCheck={props.onCheck}
              onStopCheck={props.onStopCheck}
              onLookupLanguages={props.onLookupLanguages}
              onStopLanguageLookup={props.onStopLanguageLookup}
            />
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const managerStyles = StyleSheet.create({
  content: { gap: 12 },
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
});
