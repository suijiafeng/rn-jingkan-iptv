import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme";
import type { Channel } from "../../domain/types";
import { qualityName } from "../../domain/channelSources";

export function SourceList({
  current,
  sources,
  onSelect,
}: {
  current: Channel;
  sources: Channel[];
  onSelect: (source: Channel) => void;
}) {
  return (
    <View
      style={styles.sourceList}
      accessibilityRole="list"
      testID="source-list"
    >
      {sources.map((source) => {
        const selected = source.id === current.id;
        return (
          <Pressable
            key={source.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${qualityName(source)}，${source.sourceName}${selected ? "，当前来源" : ""}`}
            style={({ pressed }) => [
              styles.sourceRow,
              selected && styles.sourceRowSelected,
              pressed && styles.pressed,
            ]}
            onPress={() => onSelect(source)}
          >
            <Text
              style={[styles.sourceText, selected && styles.accent]}
              numberOfLines={1}
            >
              {selected ? "●" : "○"} {qualityName(source)} · {source.sourceName}
            </Text>
            {source.checkStatus === "unreachable" && (
              <Text style={styles.sourceWarning}>上次检测未响应</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  accent: { color: colors.accent },
  pressed: { opacity: 0.7 },
  sourceList: { gap: 4 },
  sourceRow: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: colors.raised,
  },
  sourceRowSelected: { borderColor: colors.accent },
  sourceText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  sourceWarning: { color: colors.warn, fontSize: 11, lineHeight: 16 },
});
