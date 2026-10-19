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
import { colors, sizes, type } from "../theme";
import { UNGROUPED } from "../domain/channelLabels";
import { GroupTabs } from "./GroupTabs";

export interface FacetFiltersProps {
  options: ChannelFacetOptions;
  selected: ChannelFacetSelection;
  onChange: (selection: ChannelFacetSelection, kind?: FacetKind) => void;
  /** What the country rests on: one small line atop the country menu. */
  countryHint?: string;
  /** Content categories as one-tap tabs instead of a third menu. */
  contentAsTabs?: boolean;
  /** Only the content tabs; the country/language triggers stay folded. */
  tabsOnly?: boolean;
  testID?: string;
}

const KINDS = ["country", "language", "content"] as const;
const LABELS = { country: "国家/地区", language: "语言", content: "内容" };
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
  countryHint,
  contentAsTabs = false,
  tabsOnly = false,
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
    bar.current?.measureInWindow((windowX, windowY, _width, measuredHeight) => {
      if (generation !== measureGeneration.current) return;
      if (
        Number.isFinite(windowX) &&
        Number.isFinite(windowY) &&
        measuredHeight > 0
      )
        setAnchor({ x: windowX, y: windowY, height: measuredHeight });
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
  const menuKinds = contentAsTabs
    ? KINDS.filter((kind) => kind !== "content")
    : KINDS;
  // "" (unlabeled) is shown as 未分组 among the tabs.
  const contentTabs = options.contents.map((value) => value || UNGROUPED);
  const selectedTab = selected.content === "" ? UNGROUPED : selected.content;
  return (
    <View style={styles.column}>
      <View
        ref={bar}
        testID={testID}
        style={[styles.bar, tabsOnly && styles.hidden]}
        collapsable={false}
      >
        {menuKinds.map((kind) => (
          <Pressable
            key={kind}
            testID={`${testID}-${kind}`}
            accessibilityRole="button"
            accessibilityLabel={`${LABELS[kind]}：${facetLabel(kind, selected[kind])}`}
            accessibilityState={{ expanded: open === kind }}
            onPress={() => toggle(kind)}
            style={({ pressed }) => [
              styles.trigger,
              selected[kind] !== null && styles.selectedTrigger,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text numberOfLines={1} style={styles.triggerText}>
              <Text style={styles.dimension}>{LABELS[kind]} </Text>
              <Text style={styles.value}>
                {facetLabel(kind, selected[kind])}
              </Text>
            </Text>
            <Text style={styles.arrow}>{open === kind ? "▴" : "▾"}</Text>
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
              style={styles.overlay}
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
                  styles.panel,
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
                <ScrollView
                  testID={`${testID}-options`}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                  contentContainerStyle={styles.menuContent}
                >
                  {open === "country" && !!countryHint && (
                    <Text
                      testID={`${testID}-country-hint`}
                      numberOfLines={2}
                      style={styles.hint}
                    >
                      {countryHint}
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
                          styles.option,
                          isSelected && styles.chosenOption,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionText,
                            isSelected && styles.chosenText,
                          ]}
                        >
                          {label}
                          {value === "全部" ? "（内容分类）" : ""}
                        </Text>
                        {isSelected && <Text style={styles.chosenText}>✓</Text>}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          )}
        </Modal>
      </View>
      {contentAsTabs && (
        <GroupTabs
          groups={contentTabs}
          selected={selectedTab}
          onChange={(name) =>
            onChange(
              {
                ...selected,
                content: name === null ? null : name === UNGROUPED ? "" : name,
              },
              "content",
            )
          }
          testID={`${testID}-content-tabs`}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: 8 },
  hidden: { display: "none" },
  bar: { flexDirection: "row", gap: 8 },
  trigger: {
    flex: 1,
    minWidth: 0,
    minHeight: sizes.field,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.raised,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "transparent",
  },
  selectedTrigger: { borderColor: colors.accent },
  triggerText: { flex: 1, minWidth: 0 },
  dimension: { ...type.caption, color: colors.muted },
  value: { ...type.chip, color: colors.text, fontWeight: "600" },
  arrow: { color: colors.accent, fontSize: type.body.fontSize },
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
  menuContent: { padding: 8, gap: 4 },
  hint: {
    ...type.caption,
    color: colors.muted,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  option: {
    minHeight: sizes.button,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  chosenOption: { backgroundColor: colors.raised },
  optionText: { ...type.body, flex: 1, color: colors.text },
  chosenText: { color: colors.accent, fontWeight: "600" },
});
