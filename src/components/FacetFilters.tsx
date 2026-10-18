import React, { useRef, useState } from "react";
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  facetLabel,
  type ChannelFacetOptions,
  type ChannelFacetSelection,
  type FacetKind,
} from "../domain/channelFacets";
import { colors, styles } from "../theme";

export interface FacetFiltersProps {
  options: ChannelFacetOptions;
  selected: ChannelFacetSelection;
  onChange: (selection: ChannelFacetSelection, kind?: FacetKind) => void;
  onAutoCountry?: () => void;
  autoCountryBusy?: boolean;
  countryHint?: string;
  testID?: string;
}

const KINDS = ["country", "language", "content"] as const;
const LABELS = { country: "国别", language: "语言", content: "内容" };
const OPTION_KEYS = {
  country: "countries",
  language: "languages",
  content: "contents",
} as const;

/** Each menu clears only its own dimension; null and unmarked are distinct. */
export function FacetFilters({
  options,
  selected,
  onChange,
  onAutoCountry,
  autoCountryBusy = false,
  countryHint,
  testID = "facet-filters",
}: FacetFiltersProps) {
  const [open, setOpen] = useState<FacetKind | null>(null);
  const [anchor, setAnchor] = useState({ x: 16, y: 60, height: 56 });
  const bar = useRef<React.ElementRef<typeof View>>(null);
  const measureGeneration = useRef(0);
  const { width, height } = useWindowDimensions();
  const dismiss = () => {
    measureGeneration.current += 1;
    setOpen(null);
  };
  const toggle = (kind: FacetKind) => {
    Keyboard.dismiss();
    if (open === kind) {
      dismiss();
      return;
    }
    const generation = ++measureGeneration.current;
    setOpen(kind);
    bar.current?.measureInWindow((x, y, _width, measuredHeight) => {
      if (generation !== measureGeneration.current) return;
      if (Number.isFinite(x) && Number.isFinite(y) && measuredHeight > 0)
        setAnchor({ x, y, height: measuredHeight });
    });
  };
  const choose = (value: string | null) => {
    if (!open) return;
    const kind = open;
    dismiss();
    // Tapping the same country still records an explicit manual preference.
    if (kind === "country" || selected[kind] !== value)
      onChange({ ...selected, [kind]: value }, kind);
  };
  const available = open ? [...new Set(options[OPTION_KEYS[open]])] : [];
  const panelWidth = Math.max(1, Math.min(420, width - 32));
  const panelHeight = Math.max(1, Math.min(440, height - 48));
  const below = anchor.y + anchor.height + 6;
  const desiredTop =
    height - below - 24 >= Math.min(240, panelHeight)
      ? below
      : Math.max(24, anchor.y - panelHeight - 6);
  // Keep a previously measured anchor usable after rotating to a short screen.
  const top = Math.max(
    24,
    Math.min(desiredTop, height - 24 - Math.min(240, panelHeight)),
  );
  const maxHeight = Math.max(1, Math.min(panelHeight, height - top - 24));
  return (
    <View ref={bar} testID={testID} style={s.bar} collapsable={false}>
      {KINDS.map((kind) => (
        <Pressable
          key={kind}
          testID={`${testID}-${kind}`}
          accessibilityRole="button"
          accessibilityLabel={`${LABELS[kind]}：${facetLabel(kind, selected[kind])}`}
          accessibilityState={{ expanded: open === kind }}
          onPress={() => toggle(kind)}
          style={({ pressed }) => [
            s.trigger,
            selected[kind] !== null && s.selectedTrigger,
            pressed && { opacity: 0.7 },
          ]}
        >
          <View style={s.triggerText}>
            <Text style={s.dimension}>{LABELS[kind]}</Text>
            <Text numberOfLines={1} style={s.value}>
              {facetLabel(kind, selected[kind])}
            </Text>
          </View>
          <Text style={s.arrow}>{open === kind ? "▴" : "▾"}</Text>
        </Pressable>
      ))}
      <Modal
        testID={`${testID}-native-modal`}
        visible={open !== null}
        transparent
        statusBarTranslucent
        animationType="fade"
        onRequestClose={dismiss}
      >
        {open && (
          <View
            accessibilityViewIsModal
            style={s.overlay}
            testID={`${testID}-modal`}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              accessibilityRole="button"
              accessibilityLabel="关闭筛选菜单"
              onPress={dismiss}
            />
            <View
              style={[
                s.panel,
                {
                  width: panelWidth,
                  maxHeight,
                  left: Math.max(
                    16,
                    Math.min(anchor.x, width - panelWidth - 16),
                  ),
                  top,
                },
              ]}
            >
              <View style={s.menuHeading}>
                <Text accessibilityRole="header" style={styles.heading}>
                  选择{LABELS[open]}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`收起${LABELS[open]}筛选`}
                  onPress={dismiss}
                  style={s.close}
                >
                  <Text style={s.closeText}>收起</Text>
                </Pressable>
              </View>
              <ScrollView
                testID={`${testID}-options`}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
                contentContainerStyle={s.menuContent}
              >
                {open === "country" && onAutoCountry && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="自动识别国别"
                    accessibilityState={{ disabled: autoCountryBusy }}
                    disabled={autoCountryBusy}
                    style={s.autoOption}
                    onPress={() => {
                      dismiss();
                      onAutoCountry();
                    }}
                  >
                    <Text style={s.closeText}>
                      {autoCountryBusy ? "正在识别…" : "自动识别"}
                    </Text>
                    <Text style={styles.muted}>可随时手动选择</Text>
                  </Pressable>
                )}
                {open === "country" && !!countryHint && (
                  <Text style={s.hint} accessibilityLiveRegion="polite">
                    {countryHint}
                  </Text>
                )}
                {available.every((value) => !value) && (
                  <Text style={s.hint}>
                    {available.length
                      ? `节目单未提供${LABELS[open]}标注，可选择全部或未标注。` +
                        (open === "language"
                          ? "iptv-org 列表可在 设置 › 管理节目来源 中补全语言。"
                          : "")
                      : `当前来源暂无${LABELS[open]}选项。`}
                  </Text>
                )}
                {[null, ...available].map((value, index) => {
                  const label = facetLabel(open, value);
                  const isSelected = selected[open] === value;
                  return (
                    <Pressable
                      key={value === null ? "all" : `value:${value}`}
                      testID={`${testID}-option-${index}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${label}${value === "全部" ? "（内容分类）" : ""}`}
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => choose(value)}
                      style={({ pressed }) => [
                        s.option,
                        isSelected && s.chosenOption,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text style={[s.optionText, isSelected && s.chosenText]}>
                        {label}
                        {value === "全部" ? "（内容分类）" : ""}
                      </Text>
                      {isSelected && <Text style={s.chosenText}>✓</Text>}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", gap: 8 },
  trigger: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.raised,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "transparent",
  },
  selectedTrigger: { borderColor: colors.accent },
  triggerText: { flex: 1, minWidth: 0 },
  dimension: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  value: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
  },
  arrow: { color: colors.accent, fontSize: 14 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.42)" },
  panel: {
    position: "absolute",
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    elevation: 8,
  },
  menuHeading: {
    paddingLeft: 16,
    paddingRight: 4,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  close: {
    minWidth: 52,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { color: colors.accent, fontSize: 14, lineHeight: 21 },
  menuContent: { padding: 8, paddingTop: 0, gap: 4 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18, padding: 8 },
  autoOption: { minHeight: 52, padding: 10, gap: 2 },
  option: {
    minHeight: 48,
    padding: 12,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  chosenOption: { backgroundColor: colors.raised },
  optionText: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 23 },
  chosenText: { color: colors.accent, fontWeight: "600" },
});
