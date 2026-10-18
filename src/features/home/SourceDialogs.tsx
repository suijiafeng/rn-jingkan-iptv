import React, { useState } from "react";
import type { Repository } from "../../data/repository";
import type { Source } from "../../domain/types";
import { SourceFormModal } from "../source/SourceFormModal";
import {
  RenameSourceModal,
  SourceManagerModal,
} from "../source/SourceManagerModal";
import type { SourceImport } from "./useSourceImport";
import type { useSourceTasks } from "./useSourceTasks";

/**
 * Source management and the dialogs it opens: rename, and the add/refresh
 * form. Renaming returns to management; the form replaces it.
 */
export function SourceDialogs({
  repo,
  sources,
  managing,
  setManaging,
  renaming,
  setRenaming,
  error,
  setError,
  importer,
  sourceTasks,
  onRemoveSource,
  changed,
}: {
  repo: Repository;
  sources: Source[];
  managing: boolean;
  setManaging: (open: boolean) => void;
  renaming: Source | null;
  setRenaming: (source: Source | null) => void;
  error: string;
  setError: (message: string) => void;
  importer: SourceImport;
  sourceTasks: ReturnType<typeof useSourceTasks>;
  onRemoveSource: (source: Source) => void;
  changed: () => void;
}) {
  const [renameText, setRenameText] = useState("");
  const backToManagement = () => {
    setRenaming(null);
    setManaging(true);
  };
  return (
    <>
      <SourceManagerModal
        visible={managing}
        error={error}
        onDismissError={() => setError("")}
        sources={sources}
        check={sourceTasks.check}
        summaries={sourceTasks.checkSummaries}
        onClose={() => setManaging(false)}
        onAdd={(kind) => {
          setManaging(false);
          importer.startForm(kind);
        }}
        onRefresh={(source) => {
          setManaging(false);
          void importer.refresh(source);
        }}
        onRename={(source) => {
          setError("");
          setRenaming(source);
          setRenameText(source.name);
          setManaging(false);
        }}
        onRemove={onRemoveSource}
        onCheck={(source) => void sourceTasks.runCheck(source)}
        onStopCheck={sourceTasks.stopCheck}
        languageLookup={sourceTasks.languageLookup}
        languageMessages={sourceTasks.languageMessages}
        onLookupLanguages={(source) =>
          void sourceTasks.runLanguageLookup(source)
        }
        onStopLanguageLookup={sourceTasks.stopLanguageLookup}
      />
      <RenameSourceModal
        source={renaming}
        error={error}
        onDismissError={() => setError("")}
        text={renameText}
        onChangeText={(text) => {
          setRenameText(text);
          setError("");
        }}
        onSave={() => {
          setError("");
          if (renaming)
            void repo
              .renameSource(renaming.id, renameText.trim())
              .then(() => {
                backToManagement();
                changed();
              })
              .catch(() => setError("改名失败"));
        }}
        onCancel={backToManagement}
      />
      <SourceFormModal
        form={importer.form}
        busy={importer.busy}
        error={importer.formError || error}
        onUpdate={importer.updateForm}
        onChooseFile={() => void importer.chooseFile()}
        onPreview={() => void importer.preview()}
        onSave={() => void importer.save()}
        onClose={() => void importer.closeForm()}
      />
    </>
  );
}
