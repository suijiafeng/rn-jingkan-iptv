import type {
  ImportPreview,
  RefreshToken,
  SourceKind,
} from "../../domain/types";

export type SourceFormState = {
  kind: SourceKind;
  name: string;
  url: string;
  fileName: string;
  content: string;
  preview: ImportPreview | null;
  refresh: RefreshToken | null;
};

export const initialForm = (kind: SourceKind = "url"): SourceFormState => ({
  kind,
  name: "",
  url: "",
  fileName: "",
  content: "",
  preview: null,
  refresh: null,
});
