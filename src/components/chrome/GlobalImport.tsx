"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { FileDown } from "lucide-react";
import { isImportableFile, looksLikeUrl, normaliseUrl, useImport } from "@/lib/client/import";
import { handleFiles } from "@/lib/client/importQueue";
import { toast } from "@/lib/store/toast";
import { useT } from "@/i18n/client";

/**
 * Two app-wide ways in: drop a PDF, text file or link anywhere, and ⌘V a link or text on any page
 * other than the landing (which has its own paste handling). In the reader a paste asks first, so a
 * stray ⌘V never navigates away mid-read.
 */
export function GlobalImport() {
  const t = useT();
  const pathname = usePathname();
  const { importFile, importUrl, importText } = useImport();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const internal = useRef(false);
  const inReader = pathname.startsWith("/read/");

  useEffect(() => {
    const accepts = (dt: DataTransfer | null) => {
      if (!dt || internal.current) return false;
      const types = Array.from(dt.types ?? []);
      return types.includes("Files") || types.includes("text/uri-list");
    };
    const onDragStart = () => (internal.current = true);
    const onDragEndInternal = () => (internal.current = false);
    const onEnter = (e: DragEvent) => {
      if (!accepts(e.dataTransfer)) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (!accepts(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!accepts(e.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      depth.current = 0;
      setOver(false);
      if (!accepts(e.dataTransfer)) return;
      e.preventDefault();
      const dt = e.dataTransfer!;
      const files = Array.from(dt.files ?? []);
      // Several files go through the queue, which reports each one (an unreadable one is listed as failed, with the reason).
      if (files.length > 1) {
        handleFiles(files, () => {});
        return;
      }
      const file = files.find(isImportableFile);
      if (file) {
        void importFile(file);
        return;
      }
      if (files.length) {
        toast(t("drop.onlyFormats", { formats: t("ingest.formats") }));
        return;
      }
      const uri = (dt.getData("text/uri-list") || dt.getData("text/plain")).split(/\r?\n/).find((l) => l && !l.startsWith("#"));
      if (uri && looksLikeUrl(uri)) void importUrl(normaliseUrl(uri));
    };
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragend", onDragEndInternal);
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragend", onDragEndInternal);
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [importFile, importUrl, t]);

  useEffect(() => {
    if (pathname === "/") return; // the landing import bar owns paste there
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (document.querySelector("[role=dialog]")) return;
      const file = Array.from(e.clipboardData?.files ?? []).find(isImportableFile);
      const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
      const run = file ? () => void importFile(file) : looksLikeUrl(text) ? () => void importUrl(normaliseUrl(text)) : text.length > 40 ? () => void importText(text) : null;
      if (!run) return;
      e.preventDefault();
      const what = file ? t("drop.readFile", { name: file.name }) : looksLikeUrl(text) ? t("drop.openLink") : t("drop.readText");
      if (inReader) toast(what, { ttl: 8000, action: { label: t("common.open"), onClick: run } });
      else run();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [pathname, inReader, importFile, importText, importUrl, t]);

  if (!over) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[95] grid place-items-center bg-[color-mix(in_oklab,var(--bg)_72%,transparent)] p-6 backdrop-blur-[2px]" role="status" aria-live="polite" style={{ animation: "fade .2s var(--ease-out)" }}>
      <div className="flex items-center gap-3 rounded-[20px] border-2 border-dashed border-rule-strong bg-raised px-7 py-5 text-ink shadow-pop">
        <FileDown size={22} aria-hidden="true" className="text-[var(--rubric)]" />
        <div>
          <p className="font-serif text-[20px] leading-tight">{t("drop.title")}</p>
          <p className="mt-0.5 text-[13px] text-ink-3">{t("drop.help")}</p>
        </div>
      </div>
    </div>
  );
}
