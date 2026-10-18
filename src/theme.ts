import { StyleSheet, type TextStyle } from "react-native";
export const colors = {
  bg: "#0B1115",
  surface: "#131D23",
  raised: "#1C2A31",
  text: "#F1F5F5",
  muted: "#A6B6BD",
  /** An idle star or icon beside a row: muted at 60%. */
  mutedFaint: "#A6B6BD99",
  accent: "#8CE7D4",
  ink: "#092B26",
  line: "#293B43",
  warn: "#F3C58B",
  bad: "#FFB4AC",
};
/**
 * One type scale for every screen, taken from the player: the channel page
 * and the player sheet are shown side by side, so their text must match.
 */
export const type = {
  /** Page title (频道, 设置, 管理节目来源). */
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  /** Section and card heading. */
  heading: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  /** Body copy, inputs and primary buttons. */
  body: { fontSize: 14, lineHeight: 20 },
  /** Secondary copy under a heading or a row. */
  muted: { fontSize: 12, lineHeight: 18 },
  /** Dense labels: a row's groups, a filter's dimension name. */
  caption: { fontSize: 11, lineHeight: 16 },
  /** A filter chip or tab. */
  chip: { fontSize: 13, lineHeight: 20, fontWeight: "500" },
  /** A channel row's name. */
  rowTitle: { fontSize: 15, lineHeight: 20, fontWeight: "500" },
} satisfies Record<string, TextStyle>;
/** Control heights in dp, shared by the page, the modals and the player. */
export const sizes = {
  /** Primary and secondary buttons, option rows. */
  button: 44,
  /** Filter chips and scope tabs. */
  chip: 34,
  /** Search field and facet triggers. */
  field: 40,
  /** Hit area of text-only actions (清除, 管理, 删除). */
  touch: 48,
  /** Channel logo or monogram in a list row. */
  logo: 44,
  /** A channel row (44dp logo with 14dp above and below). */
  row: 72,
};
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 12, paddingBottom: 32 },
  title: { ...type.title, color: colors.text },
  heading: { ...type.heading, color: colors.text },
  body: { ...type.body, color: colors.text },
  muted: { ...type.muted, color: colors.muted },
  caption: { ...type.caption, color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  input: {
    minHeight: sizes.field,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: colors.raised,
    color: colors.text,
    fontSize: type.body.fontSize,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
});
