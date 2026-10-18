"use client";

import { useRef, useState } from "react";
import { Download, FileText, Upload } from "lucide-react";
import type { Block, GlossDocument } from "@/lib/content/types";
import { SAMPLES } from "@/lib/content/samples";
import { allNotesMarkdown, buildBackup, parseBackup, planRestore, type RestorePlan } from "@/lib/store/backup";
import { applyRestore, getLibrary, useLibrary } from "@/lib/store/library";
import { toast } from "@/lib/store/toast";

function save(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const today = () => new Date().toISOString().slice(0, 10);

/** Backup, restore and a Markdown export of every note: the reader's library is theirs to keep, with or without an account. */
export function BackupPanel() {
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
    if (!c.docs && !c.marks && !c.questions && !c.positions) return setError("Everything in that backup is already in your library. Nothing to restore.");
    setPlan(next);
  };

  const apply = () => {
    if (!plan) return;
    applyRestore(plan);
    toast(`Restored ${plural(plan.counts.docs, "text", "texts")} and ${plural(plan.counts.marks, "mark", "marks")}.`, { ttl: 5000 });
    setPlan(null);
  };

  const c = plan?.counts;
  return (
    <section className="lib-backup" aria-labelledby="lib-backup-h" data-testid="backup">
      <h2 id="lib-backup-h">Keep your library</h2>
      <p>
        {lib.persisted ? "Texts you save here are kept on your account; texts added without it, your marks and your questions live in this browser." : "Your texts, highlights and notes live in this browser only. A backup file keeps them safe and moves them to another browser."}{" "}
        <span className="lib-backup-n">
          {plural(mine.docs.length, "text", "texts")}, {plural(marks, "mark", "marks")}, {plural(questions, "question", "questions")} to back up.
        </span>
      </p>
      <div className="lib-backup-row">
        <button type="button" className="lib-backup-btn" onClick={() => save(`understand-io-backup-${today()}.json`, JSON.stringify(mine, null, 2), "application/json")}>
          <Download size={14} aria-hidden="true" /> Download backup
        </button>
        <button type="button" className="lib-backup-btn" onClick={() => file.current?.click()}>
          <Upload size={14} aria-hidden="true" /> Restore from backup
        </button>
        <button type="button" className="lib-backup-btn" disabled={!notes} onClick={() => save(`understand-io-notes-${today()}.md`, notes, "text/markdown")}>
          <FileText size={14} aria-hidden="true" /> Export all notes (Markdown)
        </button>
        <input ref={file} type="file" accept=".json,application/json" hidden aria-label="Backup file" onChange={(e) => void onFile(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
      </div>
      {error ? (
        <p className="lib-backup-error" role="alert">
          {error}
        </p>
      ) : null}
      {plan && c ? (
        <div className="lib-backup-plan" role="region" aria-label="Restore preview">
          <p>
            This backup adds <b>{plural(c.docs, "text", "texts")}</b>, <b>{plural(c.marks, "mark", "marks")}</b> and <b>{plural(c.questions, "question", "questions")}</b>
            {c.positions ? `, and ${plural(c.positions, "newer reading position", "newer reading positions")}` : ""}.
            {c.skippedDocs ? ` ${plural(c.skippedDocs, "text is", "texts are")} already on your shelf and stay as they are.` : ""}
            {c.skippedMarks ? ` ${plural(c.skippedMarks, "mark belongs", "marks belong")} to a text that is not here and is left out.` : ""} Nothing you have is replaced or deleted.
          </p>
          <div className="lib-backup-row">
            <button type="button" className="lib-backup-btn is-primary" onClick={apply}>
              Restore
            </button>
            <button type="button" className="lib-backup-btn" onClick={() => setPlan(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
