import React, { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackBar, Heading } from "../../components/ui";
import { languageLabel } from "../../domain/channelFacets";
import type { SourceLanguages } from "../../data/sourceLanguages";
import { colors, styles } from "../../theme";
import { Chevron, SettingRow, SettingSection } from "../settings/SettingRows";

/** Offered first; Chinese varieties lead, as in the language menu. */
export const COMMON_LANGUAGES = [
  "zh",
  "yue",
  "nan",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "ru",
  "ar",
  "pt",
  "it",
  "vi",
  "th",
  "ms",
  "id",
  "hi",
  "tr",
  "bo",
  "ug",
  "mn",
] as const;

const NONE = "不设置";
const label = (code: string) => (code ? languageLabel(code) : NONE);

/**
 * The user's own languages for one source: one for the whole source, one
 * per group. Only channels whose playlist (and iptv-org lookup) give no
 * language use them, which the caption says.
 */
export function SourceLanguageSection({
  languages,
  groups,
  disabled,
  onChange,
}: {
  languages: SourceLanguages;
  groups: string[];
  disabled: boolean;
  onChange: (languages: SourceLanguages) => void;
}) {
  // null: the whole source; a string: that group.
  const [picking, setPicking] = useState<string | null | undefined>();
  const current =
    picking === null
      ? languages.defaultLanguage
      : picking === undefined
        ? ""
        : (languages.groups[picking] ?? "");
  const choose = (code: string) => {
    if (picking === null) onChange({ ...languages, defaultLanguage: code });
    else if (picking !== undefined) {
      const { [picking]: _previous, ...others } = languages.groups;
      onChange({
        ...languages,
        groups: code ? { ...others, [picking]: code } : others,
      });
    }
    setPicking(undefined);
  };
  return (
    <>
      <Text style={styles.caption}>语言 · 只用于节目单没有写明语言的频道</Text>
      <SettingSection>
        <SettingRow
          title="整个来源"
          value={label(languages.defaultLanguage)}
          trailing={<Chevron />}
          accessibilityLabel={`整个来源的语言：${label(languages.defaultLanguage)}`}
          onPress={disabled ? undefined : () => setPicking(null)}
        />
      </SettingSection>
      {groups.length > 0 && (
        <SettingSection label="按分组（优先于整个来源）">
          {groups.map((group) => (
            <SettingRow
              key={group}
              title={group}
              value={label(languages.groups[group] ?? "")}
              trailing={<Chevron />}
              accessibilityLabel={`${group}的语言：${label(languages.groups[group] ?? "")}`}
              onPress={disabled ? undefined : () => setPicking(group)}
            />
          ))}
        </SettingSection>
      )}
      <LanguagePicker
        title={picking === null ? "整个来源的语言" : `${picking ?? ""}的语言`}
        visible={picking !== undefined}
        current={current}
        onChoose={choose}
        onClose={() => setPicking(undefined)}
      />
    </>
  );
}

function LanguagePicker({
  title,
  visible,
  current,
  onChoose,
  onClose,
}: {
  title: string;
  visible: boolean;
  current: string;
  onChoose: (code: string) => void;
  onClose: () => void;
}) {
  // A code chosen earlier but not in the common list stays offered.
  const codes: string[] =
    current && !(COMMON_LANGUAGES as readonly string[]).includes(current)
      ? [current, ...COMMON_LANGUAGES]
      : [...COMMON_LANGUAGES];
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <BackBar onBack={onClose} />
        <ScrollView contentContainerStyle={styles.content}>
          <Heading title={title} />
          <SettingSection>
            {["", ...codes].map((code) => (
              <SettingRow
                key={code || "none"}
                title={label(code)}
                accessibilityLabel={label(code)}
                trailing={
                  code === current ? (
                    <Text style={pickerStyles.check}>✓</Text>
                  ) : undefined
                }
                onPress={() => onChoose(code)}
              />
            ))}
          </SettingSection>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const pickerStyles = StyleSheet.create({
  check: { color: colors.accent, fontWeight: "700", paddingHorizontal: 4 },
});
