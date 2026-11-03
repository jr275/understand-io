"use client";

import { useRef, useState } from "react";
import { Download, FileText, Upload } from "lucide-react";
import type { Block, GlossDocument } from "@/lib/content/types";
import { SAMPLES } from "@/lib/content/samples";
import { allNotesMarkdown, buildBackup, parseBackup, planRestore, type RestorePlan } from "@/lib/store/backup";
import { applyRestore, getLibrary, useLibrary } from "@/lib/store/library";
import { toast } from "@/lib/store/toast";
import { useT } from "@/i18n/client";

function save(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const today = () => new Date().toISOString().slice(0, 10);

/** Backup, restore and a Markdown export of every note: the reader's library is theirs to keep, with or without an account. */
export function BackupPanel() {
  const t = useT();
  const lib = useLibrary();
  const file = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mine = buildBackup(lib);
  const marks = Object.values(mine.annotations).reduce((n, l) => n + l.length, 0);
  const questions = Object.values(mine.glosses).reduce((n, l) => n + l.length, 0);
  // Samples keep their words in the app, not in the store, so notes on them are exported with the text they belong to.
  const textsOf = (d: GlossDocument): Block[] => (d.blocks.length ? d.blocks : (SAMPLES.find((s) => s.slug === d.slug)?.blocks ?? []));
  const notes = allNotesMarkdown(lib, textsOf);

  const onFile = async (f: File | undefined) => {
    setError(null);
    setPlan(null);
    if (!f) return;
    const parsed = parseBackup(await f.text());
    if (!parsed.ok) return setError(parsed.error);
    const next = planRestore(getLibrary(), parsed.backup);
    const c = next.counts;
    if (!c.docs && !c.marks && !c.questions && !c.positions) return setError(t("backup.alreadyThere"));
    setPlan(next);
  };

  const apply = () => {
    if (!plan) return;
    applyRestore(plan);
    toast(t("library.restored", { texts: t("backup.nTexts", { n: plan.counts.docs }), marks: t("backup.nMarks", { n: plan.counts.marks }) }), { ttl: 5000 });
    setPlan(null);
  };

  const c = plan?.counts;
  return (
    <section className="lib-backup" aria-labelledby="lib-backup-h" data-testid="backup">
      <h2 id="lib-backup-h">{t("backup.title")}</h2>
      <p>
        {lib.persisted ? t("backup.introAccount") : t("backup.intro")}{" "}
        <span className="lib-backup-n">
          {t("backup.toBackUp", { texts: t("backup.nTexts", { n: mine.docs.length }), marks: t("backup.nMarks", { n: marks }), questions: t("backup.nQuestions", { n: questions }) })}
        </span>
      </p>
      <div className="lib-backup-row">
        <button type="button" className="lib-backup-btn" onClick={() => save(`understand-io-backup-${today()}.json`, JSON.stringify(mine, null, 2), "application/json")}>
          <Download size={14} aria-hidden="true" /> {t("backup.download")}
        </button>
        <button type="button" className="lib-backup-btn" onClick={() => file.current?.click()}>
          <Upload size={14} aria-hidden="true" /> {t("backup.restore")}
        </button>
        <button type="button" className="lib-backup-btn" disabled={!notes} onClick={() => save(`understand-io-notes-${today()}.md`, notes, "text/markdown")}>
          <FileText size={14} aria-hidden="true" /> {t("backup.exportNotes")}
        </button>
        <input ref={file} type="file" accept=".json,application/json" hidden aria-label={t("backup.fileLabel")} onChange={(e) => void onFile(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
      </div>
      {error ? (
        <p className="lib-backup-error" role="alert">
          {error}
        </p>
      ) : null}
      {plan && c ? (
        <div className="lib-backup-plan" role="region" aria-label={t("backup.preview")}>
          <p>
            {t("backup.plan", { texts: t("backup.nTexts", { n: c.docs }), marks: t("backup.nMarks", { n: c.marks }), questions: t("backup.nQuestions", { n: c.questions }), positions: c.positions ? t("backup.planPositions", { positions: t("backup.nPositions", { n: c.positions }) }) : "" })}
            {c.skippedDocs ? ` ${t("backup.skippedDocs", { n: c.skippedDocs })}` : ""}
            {c.skippedMarks ? ` ${t("backup.skippedMarks", { n: c.skippedMarks })}` : ""} {t("backup.noReplace")}
          </p>
          <div className="lib-backup-row">
            <button type="button" className="lib-backup-btn is-primary" onClick={apply}>
              {t("backup.restoreButton")}
            </button>
            <button type="button" className="lib-backup-btn" onClick={() => setPlan(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
