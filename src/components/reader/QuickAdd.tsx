"use client";

import { useRef, useState } from "react";
import { ArrowRight, FileUp, Link2, TextCursorInput } from "lucide-react";
import { ACCEPT, looksLikeUrl, normaliseUrl, useImport } from "@/lib/client/import";
import { handleFiles } from "@/lib/client/importQueue";
import { PasteDialog } from "@/components/landing/PasteDialog";
import { useT } from "@/i18n/client";

/** Compact “read something else” strip for the end of a text. */
export function QuickAdd() {
  const t = useT();
  const [url, setUrl] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, error, importUrl, importFile, importText } = useImport();
  const canRead = looksLikeUrl(url) && !busy;
  return (
    <section aria-label={t("quickAdd.label")} className="focus-hide mt-10 rounded-[18px] border border-rule bg-raised p-4 sm:p-5">
      <p className="font-serif text-[19px] leading-tight text-ink">{t("quickAdd.label")}</p>
      <p className="mt-1 text-[13px] text-ink-3">{t("quickAdd.help")}</p>
      <form
        data-field
        className="mt-3 flex items-center gap-2 rounded-[14px] border border-rule bg-bg p-1 pl-3 focus-within:border-rule-strong"
        onSubmit={(e) => {
          e.preventDefault();
          if (canRead) void importUrl(normaliseUrl(url));
        }}
      >
        <Link2 size={15} aria-hidden="true" className="shrink-0 text-ink-3" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" aria-label={t("quickAdd.linkLabel")} inputMode="url" autoComplete="off" spellCheck={false} disabled={busy === "url"} className="h-9 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-4" />
        <button type="submit" disabled={!canRead} aria-label={t("quickAdd.readLink")} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-ink px-3 text-[13px] font-medium text-bg disabled:opacity-30">
          {busy === "url" ? t("common.reading") : t("common.read")} <ArrowRight size={14} aria-hidden="true" />
        </button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink-3">
        <button type="button" className="inline-flex items-center gap-1.5 hover:text-ink" onClick={() => fileRef.current?.click()}>
          <FileUp size={14} aria-hidden="true" /> {t("common.openFiles")}
        </button>
        <button type="button" className="inline-flex items-center gap-1.5 hover:text-ink" onClick={() => setPasteOpen(true)}>
          <TextCursorInput size={14} aria-hidden="true" /> {t("common.pasteText")}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        aria-label={t("quickAdd.filesLabel")}
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files, (f) => void importFile(f));
          e.target.value = "";
        }}
      />
      {pasteOpen ? (
        <PasteDialog
          busy={!!busy}
          error={error}
          onClose={() => setPasteOpen(false)}
          onRead={async (t) => {
            if (await importText(t)) setPasteOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
