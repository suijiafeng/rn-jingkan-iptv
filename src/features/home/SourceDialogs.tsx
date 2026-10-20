import React, { useState } from "react";
import type { Repository } from "../../data/repository";
import type { Source } from "../../domain/types";
import { SourceFormModal } from "../source/SourceFormModal";
import { RenameSourceModal } from "../source/RenameSourceModal";
import { SourceManagerModal } from "../source/SourceManagerModal";
import type { SourceImport } from "./useSourceImport";
import type { useSourceTasks } from "./useSourceTasks";

/**
 * Source management and the dialogs it opens: rename, and the add/refresh
 * form. Both open on top of management, which stays open underneath, so
 * leaving them simply reveals it again. Closing one Android modal while
 * opening another in the same moment could leave the new one undrawn yet
 * still taking touches.
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
  onSetSourceEnabled,
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
  onSetSourceEnabled: (source: Source, enabled: boolean) => Promise<void>;
  changed: () => void;
}) {
  const [renameText, setRenameText] = useState("");
  const [sourceSaving, setSourceSaving] = useState<string | null>(null);
  const backToManagement = () => setRenaming(null);
  return (
    <>
      <SourceManagerModal
        visible={managing}
        // A dialog open on top shows the shared error itself.
        error={renaming || importer.form ? undefined : error}
        onDismissError={() => setError("")}
        sources={sources}
        check={sourceTasks.check}
        summaries={sourceTasks.checkSummaries}
        onClose={() => setManaging(false)}
        onAdd={(kind) => importer.startForm(kind, true)}
        onRefresh={(source) => void importer.refresh(source, true)}
        onRename={(source) => {
          setError("");
          setRenaming(source);
          setRenameText(source.name);
        }}
        onRemove={onRemoveSource}
        sourceSaving={sourceSaving}
        onEnabledChange={(source, enabled) => {
          if (sourceSaving) return;
          setSourceSaving(source.id);
          void onSetSourceEnabled(source, enabled).finally(() =>
            setSourceSaving(null),
          );
        }}
        onCheck={(source, force) => void sourceTasks.runCheck(source, force)}
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
              .catch(() => setError("名称未保存，请重试"));
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
        onBack={() => void importer.backForm()}
      />
    </>
  );
}
