"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { FileDown } from "lucide-react";
import { isImportableFile, looksLikeUrl, normaliseUrl, useImport } from "@/lib/client/import";
import { toast } from "@/lib/store/toast";

/**
 * Two app-wide ways in: drop a PDF, text file or link anywhere, and ⌘V a link or text on any page
 * other than the landing (which has its own paste handling). In the reader a paste asks first, so a
 * stray ⌘V never navigates away mid-read.
 */
export function GlobalImport() {
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
      const file = Array.from(dt.files ?? []).find(isImportableFile);
      if (file) {
        void importFile(file);
        return;
      }
      if (dt.files?.length) {
        toast("Only PDF, text and markdown files can be read.");
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
  }, [importFile, importUrl]);

  useEffect(() => {
    if (pathname === "/") return; // the landing import bar owns paste there
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (document.querySelector("[role=dialog]")) return;
      const file = Array.from(e.clipboardData?.files ?? []).find(isImportableFile);
      const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
      const run = file ? () => void importFile(file) : looksLikeUrl(text) ? () => void importUrl(normaliseUrl(text)) : text.length > 40 ? () => void importText(text) : null;
      if (!run) return;
      e.preventDefault();
      const what = file ? `Read “${file.name}”?` : looksLikeUrl(text) ? "Open the pasted link?" : "Read the pasted text?";
      if (inReader) toast(what, { ttl: 8000, action: { label: "Open", onClick: run } });
      else run();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [pathname, inReader, importFile, importText, importUrl]);

  if (!over) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[95] grid place-items-center bg-[color-mix(in_oklab,var(--bg)_72%,transparent)] p-6 backdrop-blur-[2px]" role="status" aria-live="polite" style={{ animation: "fade .2s var(--ease-out)" }}>
      <div className="flex items-center gap-3 rounded-[20px] border-2 border-dashed border-rule-strong bg-raised px-7 py-5 text-ink shadow-pop">
        <FileDown size={22} aria-hidden="true" className="text-[var(--rubric)]" />
        <div>
          <p className="font-serif text-[20px] leading-tight">Drop to read</p>
          <p className="mt-0.5 text-[13px] text-ink-3">A PDF, a text file or a link</p>
        </div>
      </div>
    </div>
  );
}
