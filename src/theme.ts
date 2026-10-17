import { StyleSheet } from "react-native";
export const colors = {
  bg: "#0B1115",
  surface: "#131D23",
  raised: "#1C2A31",
  text: "#F1F5F5",
  muted: "#A6B6BD",
  accent: "#8CE7D4",
  ink: "#092B26",
  line: "#293B43",
  warn: "#F3C58B",
  bad: "#FFB4AC",
};
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 12, paddingBottom: 32 },
  title: {
    fontSize: 24,
    lineHeight: 36,
    fontWeight: "700",
    color: colors.text,
  },
  heading: {
    fontSize: 18,
    lineHeight: 27,
    fontWeight: "600",
    color: colors.text,
  },
  body: { fontSize: 15, lineHeight: 23, color: colors.text },
  muted: { fontSize: 12, lineHeight: 18, color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  input: {
    minHeight: 55,
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.raised,
    color: colors.text,
    fontSize: 15,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
});
