"use client";

import { track } from "@/lib/client/analytics";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, ArrowUp, ArrowUpRight, BookOpenCheck, Headphones, Keyboard, NotebookPen, Search } from "lucide-react";
import type { Anchor, Annotation, Evidence, Gloss, GlossAction, GlossDocument, HighlightColor, SummaryVariant } from "@/lib/content/types";
import { findReusable, isInsight, regenerable } from "@/lib/ai/results";
import { contentHash } from "@/lib/content/hash";
import { decideAnnotate, marksOnRange } from "@/lib/anchors/annotate";
import { anchorBlockIds, anchorFromSelection, blockIndex, clampNote, makeAnchor, rangeForAnchor, resolveAll, resolveCached, segmentBlock } from "@/lib/anchors";
import { Bm25Index, buildPassages, type Hit } from "@/lib/search/bm25";
import { findAll, sections as outlineOf, type Section } from "@/lib/search/find";
import { SpeechController } from "@/lib/speech/controller";
import { newId } from "@/lib/content/slug";
import { guessLang } from "@/lib/content/lang";
import { useSettings } from "@/lib/store/settings";
import { addAnnotation, persistGloss, rememberDocument, removeAnnotation, removeGloss, setProgress, syncDocumentData, updateAnnotation, upsertGloss, useLibrary } from "@/lib/store/library";
import { toast } from "@/lib/store/toast";
import { hasAnyKey, streamGloss, type GlossMeta } from "@/lib/client/glossStream";
import { blocksAround, callAiOp, documentBlocks, type AiOpRequest } from "@/lib/client/aiOps";
import { useMounted } from "@/lib/client/useMounted";
import { Topbar } from "@/components/chrome/Topbar";
import { Toasts } from "@/components/chrome/Toasts";
import { KeysDialog } from "@/components/chrome/KeysDialog";
import { IconButton } from "@/components/ui/IconButton";
import { Block } from "./Block";
import { Lens } from "./Lens";
import { MarginGlosses, type MarginItem } from "./MarginGlosses";
import { Composer } from "./Composer";
import { Rail } from "./Rail";
import { Notebook } from "./Notebook";
import { InsightsPanel } from "./InsightsPanel";
import { FindBar } from "./FindBar";
import { ListenBar } from "./ListenBar";
import { VoiceSearch } from "./VoiceSearch";
import { QuickAdd } from "./QuickAdd";
import { useT } from "@/i18n/client";
import { tNow } from "@/i18n/runtime";

const EMPTY_A: Annotation[] = [];
const EMPTY_G: Gloss[] = [];

export function Reader({ doc }: { doc: GlossDocument }) {
  const t = useT();
  const documentId = doc.id ?? `local:${doc.slug}`;
  const blocks = doc.blocks;
  const [settings, setSettings] = useSettings();
  const lib = useLibrary();
  const annotations = lib.annotations[documentId] ?? EMPTY_A;
  const allGlosses = lib.glosses[documentId] ?? EMPTY_G;
  // Margin answers and structured results (summaries, translations...) are different things: only the first kind lives in the margin.
  const glosses = useMemo(() => allGlosses.filter((g) => !isInsight(g)), [allGlosses]);
  const insights = useMemo(() => allGlosses.filter(isInsight).sort((a, b) => b.createdAt - a.createdAt), [allGlosses]);
  // Every anchor is resolved once (cached per anchor): painting, clicking marks, margin cards, the rail and the notebook all use this result.
  const blockIdx = useMemo(() => blockIndex(blocks), [blocks]);
  const resolvedAnn = useMemo(() => resolveAll(blocks, annotations, blockIdx), [blocks, annotations, blockIdx]);
  const resolvedGl = useMemo(() => resolveAll(blocks, glosses, blockIdx), [blocks, glosses, blockIdx]);
  const rootRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState<{ anchor: Anchor; rect: DOMRect } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [hit, setHit] = useState<Anchor | null>(null);
  const [nbOpen, setNbOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCur, setFindCur] = useState(0);
  const [keysOpen, setKeysOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [ratio, setRatio] = useState(0);
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState(false);
  const [resizeTick, setResizeTick] = useState(0);
  const [firstTop, setFirstTop] = useState(0);
  const [serverInfo, setServerInfo] = useState<{ serverKey: boolean; model: string } | null>(null);
  const abortRef = useRef<Map<string, AbortController>>(new Map());
  const mounted = useMounted();

  /* ---------- speech ---------- */
  const [speech] = useState(() => new SpeechController());
  const snap = useSyncExternalStore(speech.store.subscribe, speech.store.getSnapshot, speech.store.getSnapshot);
  const docLang = useMemo(() => guessLang(doc.blocks), [doc]);
  useEffect(() => {
    speech.setBlocks(blocks);
  }, [speech, blocks]);
  useEffect(() => {
    speech.setLang(docLang);
  }, [speech, docLang]);
  // attach/detach (not construct/dispose): React StrictMode mounts, unmounts and mounts again with the same instance.
  useEffect(() => {
    speech.attach();
    return () => speech.detach();
  }, [speech]);
  useEffect(() => {
    speech.setRate(settings.rate);
  }, [speech, settings.rate]);
  useEffect(() => {
    speech.setVoice(settings.voice);
  }, [speech, settings.voice]);
  // Keep the sentence being read in view: follow the highlighted sentence (not its paragraph, which can be taller than the
  // screen), respect reduced motion, and stop following once the reader scrolls on their own until they resume or skip.
  const followSpeech = useRef(true);
  const prevSpeechState = useRef(snap.state);
  useEffect(() => {
    if (snap.state === "playing" && prevSpeechState.current !== "playing") followSpeech.current = true;
    prevSpeechState.current = snap.state;
  }, [snap.state]);
  useEffect(() => {
    const onUserScroll = () => {
      if (speech.snapshot().state === "playing") followSpeech.current = false;
    };
    window.addEventListener("wheel", onUserScroll, { passive: true });
    window.addEventListener("touchmove", onUserScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchmove", onUserScroll);
    };
  }, [speech]);
  useEffect(() => {
    const seg = snap.segment;
    if (!seg || snap.state !== "playing" || !followSpeech.current) return;
    const root = rootRef.current;
    const el = root?.querySelector<HTMLElement>(".m-speak") ?? root?.querySelector<HTMLElement>(`.blk[data-block="${CSS.escape(seg.blockId)}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top >= 120 && r.bottom <= window.innerHeight - 200) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: r.top + window.scrollY - window.innerHeight * 0.3, behavior: reduced ? "auto" : "smooth" });
  }, [snap.segment, snap.state]);
  useEffect(() => {
    if (snap.state === "error" && snap.error) toast(snap.error);
  }, [snap.state, snap.error]);

  /* ---------- mount: remember, sync, deep link, hint ---------- */
  useEffect(() => {
    rememberDocument(doc, !documentId.startsWith("local:"));
    // `persisted` is decided by the server's answer in syncDocumentData, never guessed here.
    void syncDocumentData(documentId);
    fetch("/api/gloss")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setServerInfo({ serverKey: !!j.serverKey, model: j.model }))
      .catch(() => setServerInfo({ serverKey: false, model: "" }));
    const mq = window.matchMedia("(max-width: 1079px)");
    const onMq = () => setSheet(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);
    const onResize = () => setResizeTick((k) => k + 1);
    window.addEventListener("resize", onResize);
    try {
      if (mq.matches && !localStorage.getItem("gloss:nudge")) {
        localStorage.setItem("gloss:nudge", String(Date.now()));
        toast(tNow("reader.hintSelect"), { ttl: 7000 });
      }
    } catch {
      /* ignore */
    }
    return () => {
      mq.removeEventListener("change", onMq);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  /* ---------- scroll: progress, read blocks, topbar ---------- */
  const userScrolled = useRef(false);
  useEffect(() => {
    let raf = 0;
    const onScroll = (e?: Event) => {
      if (e) userScrolled.current = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const r = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
        setRatio(r);
        setScrolled(window.scrollY > 240);
        const els = rootRef.current?.querySelectorAll<HTMLElement>(".blk[data-n]") ?? [];
        let current: string | undefined;
        const read = new Set<string>();
        for (const el of els) {
          const b = el.getBoundingClientRect();
          if (b.bottom < 60) read.add(el.dataset.block!);
          if (!current && b.bottom > 100) current = el.dataset.block;
        }
        setReadSet(read);
        // Only the reader's own scrolling counts as progress; the initial paint must not
        // overwrite progress synced from the server.
        if (userScrolled.current) setProgress(documentId, { ratio: r, blockId: current, finished: max > 0 && r > 0.97 });
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [documentId]);

  /* ---------- selection → lens ---------- */
  const dismissRef = useRef(false);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".lens")) return;
      dismissRef.current = true;
    };
    const onChange = () => {
      const sel = document.getSelection();
      if (!sel || !rootRef.current) return;
      if (document.activeElement?.closest?.(".lens")) return;
      if (sel.isCollapsed) {
        if (dismissRef.current) {
          setPending(null);
          dismissRef.current = false;
        }
        return;
      }
      const node = sel.anchorNode;
      if (!node || !rootRef.current.contains(node) || !(node.parentElement ?? (node as Element)).closest?.(".prose-read")) return;
      const a = anchorFromSelection(sel, blocks);
      if (!a) return;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setPending({ anchor: a, rect: r });
      dismissRef.current = false;
    };
    let t: number | undefined;
    const debounced = () => {
      window.clearTimeout(t);
      t = window.setTimeout(onChange, 60);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("selectionchange", debounced);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("selectionchange", debounced);
      window.clearTimeout(t);
    };
  }, [blocks]);

  const clearSelection = useCallback(() => {
    document.getSelection()?.removeAllRanges();
    setPending(null);
  }, []);

  /* ---------- helpers ---------- */
  const blockEl = useCallback((id: string) => rootRef.current?.querySelector<HTMLElement>(`.blk[data-block="${CSS.escape(id)}"]`) ?? null, []);
  const flashBlock = useCallback((id: string) => {
    setFlash(id);
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1900);
  }, []);
  // Jumps made on purpose (a citation, a search hit, a section) remember where the reader was, so they can go back.
  const [backTo, setBackTo] = useState<{ y: number } | null>(null);
  const scrollToBlock = useCallback(
    (id: string, remember = false) => {
      const el = blockEl(id);
      if (!el) return;
      if (remember) setBackTo((prev) => prev ?? { y: window.scrollY });
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 140, behavior: "smooth" });
      flashBlock(id);
      setCursor(id);
    },
    [flashBlock, blockEl],
  );
  const jumpToAnchor = useCallback(
    (a: Anchor) => {
      const resolved = resolveCached(blocks, a, blockIdx).anchor;
      if (!resolved) return void toast(tNow("reader.passageGone"), { ttl: 3500 });
      scrollToBlock(resolved.start.b, true);
    },
    [blocks, blockIdx, scrollToBlock],
  );
  const onCite = useCallback(
    (n: number) => {
      const b = blocks.find((x) => x.n === n);
      if (b) scrollToBlock(b.id, true);
    },
    [blocks, scrollToBlock],
  );
  const blockAnchor = useCallback((id: string) => {
    const b = blocks.find((x) => x.id === id);
    if (!b) return null;
    return makeAnchor(blocks, { b: id, o: 0 }, { b: id, o: b.text.length });
  }, [blocks]);

  const jumpedRef = useRef(false);
  useEffect(() => {
    // Resume where the reader left off, or follow ?hl=. Runs again as server data arrives,
    // but only acts once, and never after the reader has started scrolling.
    if (jumpedRef.current || userScrolled.current) return;
    const params = new URLSearchParams(window.location.search);
    const hl = params.get("hl");
    const at = params.get("at");
    const t = window.setTimeout(() => {
      if (jumpedRef.current || userScrolled.current) return;
      if (at) {
        // A passage found by the library search: open on it and mark the sentence for a few seconds.
        const b = blocks.find((x) => x.id === at);
        if (!b) return; // wait for the text to load
        const num = (k: string, fallback: number) => {
          const v = Number(params.get(k));
          return Number.isInteger(v) && v >= 0 ? Math.min(v, b.text.length) : fallback;
        };
        const start = num("s", 0);
        const end = Math.max(start, num("e", b.text.length));
        const a: Anchor = { start: { b: at, o: start }, end: { b: at, o: end }, quote: b.text.slice(start, end) };
        jumpedRef.current = true;
        setHit(a);
        scrollToBlock(at, true);
        window.setTimeout(() => setHit((x) => (x === a ? null : x)), 6000);
        return;
      }
      if (hl) {
        const a = annotations.find((x) => x.id === hl);
        if (!a) return; // wait for sync
        jumpedRef.current = true;
        jumpToAnchor(a.anchor);
        return;
      }
      const p = lib.progress[documentId];
      if (p?.blockId && p.ratio > 0.03 && p.ratio < 0.97) {
        const el = blockEl(p.blockId);
        if (el) {
          jumpedRef.current = true;
          window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 140 });
        }
      }
    }, 120);
    return () => window.clearTimeout(t);
  }, [documentId, annotations, lib.progress, jumpToAnchor, blockEl, blocks, scrollToBlock]);

  /* ---------- annotations ---------- */
  const annotate = useCallback(
    (kind: Annotation["kind"], color: HighlightColor, note?: string) => {
      if (!pending) return;
      // The same kind on an identical range does not stack: the same colour takes the mark off, another colour recolours it.
      const decision = decideAnnotate(resolvedAnn, pending.anchor, kind, color);
      if (decision.type !== "add") {
        for (const id of decision.ids) {
          if (decision.type === "remove") removeAnnotation(documentId, id);
          else updateAnnotation(documentId, id, { color });
        }
        clearSelection();
        toast(decision.type === "remove" ? (kind === "underline" ? tNow("reader.underlineRemoved") : tNow("reader.highlightRemoved")) : tNow("reader.colourChanged"), { ttl: 2200 });
        return;
      }
      const a: Annotation = { id: newId(), documentId, kind, color, note: note === undefined ? undefined : clampNote(note), anchor: pending.anchor, createdAt: Date.now(), updatedAt: Date.now() };
      addAnnotation(a);
      track("highlight_created", { mark: a.kind }); // the kind of mark only: never its text, quote or note
      clearSelection();
      if (kind === "note") setActiveId(a.id);
      toast(lib.persisted ? tNow("reader.keptLibrary") : tNow("reader.keptBrowser"), { ttl: 2600 });
    },
    [pending, documentId, clearSelection, lib.persisted, resolvedAnn],
  );
  // Highlights and underlines that already cover exactly the selected range (the lens offers to remove them).
  const pendingMarks = useMemo(() => (pending ? marksOnRange(resolvedAnn, pending.anchor) : []), [pending, resolvedAnn]);

  /* ---------- glosses ---------- */
  const index = useMemo(() => new Bm25Index(buildPassages(blocks)), [blocks]);
  const contextFor = useCallback(
    (anchor: Anchor | null, question: string | undefined, action: GlossAction) => {
      const ctx: { id: string; n?: number; text: string }[] = [];
      const seen = new Set<string>();
      const push = (id: string) => {
        if (seen.has(id)) return;
        const b = blocks.find((x) => x.id === id);
        if (b && b.type !== "figure") {
          seen.add(id);
          ctx.push({ id: b.id, n: b.n, text: b.text });
        }
      };
      if (anchor) {
        const ids = anchorBlockIds(blocks, anchor);
        const i0 = blocks.findIndex((b) => b.id === ids[0]);
        const i1 = blocks.findIndex((b) => b.id === ids[ids.length - 1]);
        for (let i = Math.max(0, i0 - 2); i <= Math.min(blocks.length - 1, i1 + 2); i++) push(blocks[i].id);
      }
      blocks.slice(0, 3).forEach((b) => push(b.id));
      if (question || action === "overview" || action === "related" || action === "whole") {
        const q = question || anchor?.quote || doc.title;
        for (const h of index.search(q, 14).hits) push(h.blockId);
      }
      if (action === "overview" || action === "whole") {
        // Spread sampling across the text so the overview sees its shape.
        const step = Math.max(1, Math.floor(blocks.length / 18));
        for (let i = 0; i < blocks.length; i += step) push(blocks[i].id);
      }
      let chars = 0;
      return ctx
        .sort((a, b) => blocks.findIndex((x) => x.id === a.id) - blocks.findIndex((x) => x.id === b.id))
        .filter((c) => (chars += c.text.length) < 24000);
    },
    [blocks, index, doc.title],
  );

  const runGloss = useCallback(
    async (g: Gloss, question: string | undefined) => {
      const ctrl = new AbortController();
      abortRef.current.get(g.id)?.abort();
      abortRef.current.set(g.id, ctrl);
      // Everything before the pending assistant turn, minus the question itself (it goes in the prompt).
      const history = g.turns.slice(0, question ? -2 : -1).filter((t) => t.content);
      let current: Gloss = { ...g, status: "streaming", error: undefined };
      upsertGloss(current);
      const context = contextFor(g.anchor, question, g.action);
      const meta: GlossMeta = await streamGloss(
        { title: doc.title, author: doc.author, action: g.action, question, anchor: g.anchor, context, length: settings.length, history: history.length ? history : undefined },
        (full) => {
          current = { ...current, turns: [...current.turns.slice(0, -1), { role: "assistant", content: full }] };
          upsertGloss(current);
        },
        ctrl.signal,
      ).catch((e: unknown): GlossMeta => ({ error: e instanceof Error && e.name === "AbortError" ? undefined : String(e) }));
      if (abortRef.current.get(g.id) === ctrl) abortRef.current.delete(g.id);
      if (ctrl.signal.aborted) return; // deleted or superseded while streaming: leave the store alone
      if (meta.error) {
        current = { ...current, status: "error", error: meta.error };
        upsertGloss(current);
        if (/key/i.test(meta.error)) toast(tNow("reader.needsKeyAnswers"), { ttl: 7000 });
        return;
      }
      // Remember which paragraphs the model was given: its ¶ citations are checked against them, and an overview says how much it read.
      const total = blocks.filter((b) => b.n).length;
      const used = context.filter((c) => c.n).length;
      const nums = context.map((c) => c.n).filter((n): n is number => typeof n === "number");
      const complete = used >= total;
      const result = {
        kind: "stream" as const,
        context: context.map((c) => c.id),
        coverage: { used, total, from: nums.length ? Math.min(...nums) : 0, to: nums.length ? Math.max(...nums) : 0, complete, note: complete ? undefined : tNow("reader.coverageNote", { used, total }) },
      };
      current = { ...current, status: "done", model: meta.model ?? current.model, usage: meta.usage ?? current.usage, result };
      upsertGloss(current);
      persistGloss(current);
    },
    [doc.title, doc.author, contextFor, settings.length, blocks],
  );

  const citeSetFor = useCallback(
    (g: Gloss) => {
      if (g.result?.kind !== "stream") return null;
      return new Set(g.result.context.map((id) => blocks.find((b) => b.id === id)?.n).filter((n): n is number => typeof n === "number"));
    },
    [blocks],
  );

  const createGloss = useCallback(
    (action: GlossAction, anchor: Anchor | null, question?: string) => {
      const g: Gloss = {
        id: newId(),
        documentId,
        action,
        anchor,
        turns: [...(question ? [{ role: "user" as const, content: question }] : []), { role: "assistant" as const, content: "" }],
        createdAt: Date.now(),
        status: "streaming",
      };
      upsertGloss(g);
      setActiveId(g.id);
      clearSelection();
      void runGloss(g, question);
    },
    [documentId, clearSelection, runGloss],
  );

  /* ---------- structured results: summaries, concepts, questions, translation ---------- */
  const targetLang = settings.targetLang || (docLang === "pt" ? "en" : "pt");
  const blocksRef = useRef(blocks);
  /** Hash of the text on screen, to tell which saved results were written for it. Empty until the first one is computed. */
  const [docHash, setDocHash] = useState("");
  useEffect(() => {
    blocksRef.current = blocks;
    let live = true;
    void contentHash(blocks).then((h) => live && setDocHash(h));
    return () => {
      live = false;
    };
  }, [blocks]);
  const [focusInsight, setFocusInsight] = useState<{ id: string; n: number } | null>(null);
  const insightJobs = useRef<Map<string, AiOpRequest>>(new Map());
  const insightRanges = useRef<Map<string, { from: number; to: number }>>(new Map());
  const runInsight = useCallback(
    async (g: Gloss) => {
      const req = insightJobs.current.get(g.id);
      if (!req) return;
      const ctrl = new AbortController();
      abortRef.current.get(g.id)?.abort();
      abortRef.current.set(g.id, ctrl);
      upsertGloss({ ...g, status: "streaming", error: undefined });
      // The text this result is written for, fixed before the model reads it: the result records it so a later change is noticed.
      const hash = await contentHash(blocksRef.current);
      const out = await callAiOp(req, ctrl.signal);
      if (abortRef.current.get(g.id) === ctrl) abortRef.current.delete(g.id);
      if (ctrl.signal.aborted) return; // cancelled or deleted: leave the store alone
      if (out.error || !out.result) {
        upsertGloss({ ...g, status: "error", error: out.error ?? tNow("reader.didNotWork") });
        if (out.needsKey) toast(tNow("reader.needsKey"), { ttl: 7000 });
        return;
      }
      const range = insightRanges.current.get(g.id);
      const stamped = { ...out.result, docHash: hash, outLang: req.outputLang ?? "" };
      const result = stamped.kind === "translation" && range ? { ...stamped, range } : stamped;
      const done: Gloss = { ...g, status: "done", error: undefined, result, model: out.model, usage: out.usage ?? null };
      upsertGloss(done);
      persistGloss(done);
    },
    [],
  );
  const startInsight = useCallback(
    (action: "summarize" | "translate" | "concepts" | "questions", req: AiOpRequest, anchor: Anchor | null) => {
      const g: Gloss = { id: newId(), documentId, action, anchor, turns: [], createdAt: Date.now(), status: "streaming" };
      insightJobs.current.set(g.id, req);
      upsertGloss(g);
      setInsightsOpen(true);
      setNbOpen(false);
      setFindOpen(false);
      void runInsight(g);
    },
    [documentId, runInsight],
  );
  const runDocumentOp = useCallback(
    (op: "summarize" | "concepts" | "questions", variant?: SummaryVariant, startIndex = 0, force = false) => {
      // The same operation, written for exactly this text and language, already exists: show it instead of asking the model again.
      if (!force && startIndex === 0) {
        const hit = findReusable(insights, { op, variant, outLang: settings.outLang || "" }, docHash);
        if (hit) {
          setInsightsOpen(true);
          setNbOpen(false);
          setFindOpen(false);
          setFocusInsight((f) => ({ id: hit.id, n: (f?.n ?? 0) + 1 }));
          toast(tNow("reader.alreadyHave"), { ttl: 5200 });
          return;
        }
      }
      const { blocks: bs, totalParagraphs } = documentBlocks(doc, startIndex);
      if (!bs.length) return void toast(tNow("reader.noText"), { ttl: 3000 });
      startInsight(op, { op, variant, title: doc.title, author: doc.author, blocks: bs, totalParagraphs, outputLang: settings.outLang || undefined }, null);
    },
    [doc, startInsight, settings.outLang, insights, docHash],
  );
  const runPassageOp = useCallback(
    (kind: "translate" | "summarize", anchor: Anchor) => {
      if (anchor.quote.length > 6000) return void toast(tNow("reader.tooLong"), { ttl: 4500 });
      const ids = anchorBlockIds(blocks, anchor);
      const totalParagraphs = blocks.filter((b) => b.n).length;
      if (kind === "translate") startInsight("translate", { op: "translate", title: doc.title, author: doc.author, blocks: blocksAround(blocks, ids, 0), totalParagraphs, selection: anchor.quote, targetLang }, anchor);
      else startInsight("summarize", { op: "summarize", variant: "passage", title: doc.title, author: doc.author, blocks: blocksAround(blocks, ids, 0), totalParagraphs, selection: anchor.quote, outputLang: settings.outLang || undefined }, anchor);
    },
    [blocks, doc.title, doc.author, startInsight, targetLang, settings.outLang],
  );
  /** Translate a part of the text (about a page), starting at the paragraph on screen or just after a part already translated. */
  const translatePart = useCallback(
    (afterParagraph?: number) => {
      let start = -1;
      if (afterParagraph !== undefined) {
        const i = blocks.findIndex((b) => b.n === afterParagraph);
        start = i < 0 ? -1 : i + 1;
      } else {
        const first = [...document.querySelectorAll<HTMLElement>(".blk")].find((el) => el.getBoundingClientRect().bottom > 120);
        start = first ? blocks.findIndex((b) => b.id === first.dataset.block) : 0;
      }
      if (start < 0 || start >= blocks.length) return void toast(tNow("reader.nothingToTranslate"), { ttl: 3000 });
      const parts: string[] = [];
      const nums: number[] = [];
      let chars = 0;
      for (let i = start; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.type === "figure" || !b.text.trim()) continue;
        if (parts.length && chars + b.text.length > 5500) break;
        parts.push(b.text.slice(0, 5500));
        chars += b.text.length;
        if (b.n) nums.push(b.n);
      }
      if (!parts.length) return void toast(tNow("reader.nothingToTranslate"), { ttl: 3000 });
      const req: AiOpRequest = { op: "translate", title: doc.title, author: doc.author, blocks: [], totalParagraphs: blocks.filter((b) => b.n).length, selection: parts.join("\n\n"), targetLang };
      const g: Gloss = { id: newId(), documentId, action: "translate", anchor: null, turns: [], createdAt: Date.now(), status: "streaming" };
      insightJobs.current.set(g.id, req);
      if (nums.length) insightRanges.current.set(g.id, { from: Math.min(...nums), to: Math.max(...nums) });
      upsertGloss(g);
      setInsightsOpen(true);
      setNbOpen(false);
      setFindOpen(false);
      void runInsight(g);
    },
    [blocks, doc.title, doc.author, documentId, targetLang, runInsight],
  );
  const cancelInsight = useCallback(
    (id: string) => {
      abortRef.current.get(id)?.abort();
      abortRef.current.delete(id);
      insightJobs.current.delete(id);
      removeGloss(documentId, id);
    },
    [documentId],
  );
  const retryInsight = useCallback(
    (id: string) => {
      const g = allGlosses.find((x) => x.id === id);
      if (!g) return;
      if (!insightJobs.current.has(id)) {
        // After a reload the request is gone: say so and clear the failed card instead of pretending to retry.
        toast(tNow("reader.cannotRepeat"), { ttl: 4500 });
        return void cancelInsight(id);
      }
      void runInsight(g);
    },
    [allGlosses, runInsight, cancelInsight],
  );
  const continueSummary = useCallback(
    (g: Gloss) => {
      const r = g.result;
      if (!r || r.kind !== "summary") return;
      const next = blocks.findIndex((b) => b.n === r.coverage.to + 1);
      if (next < 0) return;
      runDocumentOp("summarize", r.variant === "passage" ? "quick" : r.variant, next);
    },
    [blocks, runDocumentOp],
  );
  const jumpToEvidence = useCallback(
    (e: Evidence) => {
      const b = blocks.find((x) => x.id === e.blockId);
      if (!b || b.text.slice(e.start, e.end) !== e.quote) return void toast(tNow("reader.quoteMoved"), { ttl: 3500 });
      const a = makeAnchor(blocks, { b: e.blockId, o: e.start }, { b: e.blockId, o: e.end }, blockIdx);
      jumpToAnchor(a);
      setHit(a);
      if (sheet) setInsightsOpen(false);
    },
    [blocks, blockIdx, jumpToAnchor, sheet],
  );
  // One side panel at a time, and the find bar shares their corner, so it gives way to them.
  const toggleNotebook = useCallback(() => {
    if (!nbOpen) {
      setInsightsOpen(false);
      setFindOpen(false);
    }
    setNbOpen(!nbOpen);
  }, [nbOpen]);
  const toggleInsights = useCallback(() => {
    if (!insightsOpen) {
      setNbOpen(false);
      setFindOpen(false);
    }
    setInsightsOpen(!insightsOpen);
  }, [insightsOpen]);

  /* ---------- find in the text (literal) ---------- */
  const found = useMemo(() => (findOpen ? findAll(blocks, findQuery) : { matches: [], truncated: false }), [findOpen, blocks, findQuery]);
  const sectionList = useMemo(() => outlineOf(blocks), [blocks]);
  const openFind = useCallback(() => {
    setNbOpen(false);
    setInsightsOpen(false);
    setFindOpen(true);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[role=search] input')?.focus());
  }, []);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    setFindCur(0);
  }, []);
  const stepFind = useCallback((d: number) => setFindCur((c) => (found.matches.length ? (c + d + found.matches.length) % found.matches.length : 0)), [found.matches.length]);
  const curMatch = found.matches[Math.min(findCur, Math.max(0, found.matches.length - 1))];
  useEffect(() => {
    if (!findOpen || !curMatch) return;
    const id = requestAnimationFrame(() => document.querySelector(".find-mark.is-current")?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
    return () => cancelAnimationFrame(id);
  }, [findOpen, curMatch]);

  const deleteGloss = useCallback(
    (id: string) => {
      abortRef.current.get(id)?.abort();
      abortRef.current.delete(id);
      removeGloss(documentId, id);
      setActiveId((cur) => (cur === id ? null : cur));
    },
    [documentId],
  );

  const followUp = useCallback(
    (id: string, q: string) => {
      const g = glosses.find((x) => x.id === id);
      if (!g) return;
      const next: Gloss = { ...g, turns: [...g.turns, { role: "user", content: q }, { role: "assistant", content: "" }] };
      upsertGloss(next);
      void runGloss(next, q);
    },
    [glosses, runGloss],
  );

  /* ---------- questions asked in the voice panel ---------- */
  const [voiceGlossId, setVoiceGlossId] = useState<string | null>(null);
  const askByVoice = useCallback(
    (q: string, again: boolean) => {
      const existing = again && voiceGlossId ? allGlosses.find((x) => x.id === voiceGlossId) : undefined;
      if (existing) return void followUp(existing.id, q);
      const g: Gloss = { id: newId(), documentId, action: "whole", anchor: null, turns: [{ role: "user", content: q }, { role: "assistant", content: "" }], createdAt: Date.now(), status: "streaming" };
      upsertGloss(g);
      setVoiceGlossId(g.id);
      void runGloss(g, q);
    },
    [voiceGlossId, allGlosses, followUp, documentId, runGloss],
  );
  const voiceConversation = useMemo(() => {
    const g = voiceGlossId ? glosses.find((x) => x.id === voiceGlossId) : undefined;
    return g ? { id: g.id, turns: g.turns, status: g.status, error: g.error, cites: g.result?.kind === "stream" ? new Set(g.result.context.map((id) => blocks.find((b) => b.id === id)?.n).filter((n): n is number => typeof n === "number")) : null } : null;
  }, [voiceGlossId, glosses, blocks]);

  const retry = useCallback(
    (id: string) => {
      const g = glosses.find((x) => x.id === id);
      if (!g) return;
      const lastQ = [...g.turns].reverse().find((t) => t.role === "user")?.content;
      const next: Gloss = { ...g, turns: [...g.turns.slice(0, g.turns.length - 1), { role: "assistant", content: "" }] };
      void runGloss(next, lastQ);
    },
    [glosses, runGloss],
  );

  /* ---------- read aloud: where to start, and what to say when the browser cannot ---------- */
  /** One rule for every entry point: the selected paragraph if it is on screen, else the first paragraph on screen, else the top. */
  const readingStart = useCallback(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    if (cursor) {
      const r = root.querySelector<HTMLElement>(`.blk[data-block="${CSS.escape(cursor)}"]`)?.getBoundingClientRect();
      if (r && r.bottom > 0 && r.top < window.innerHeight) return cursor;
    }
    if (window.scrollY < 240) return undefined;
    for (const el of root.querySelectorAll<HTMLElement>(".blk[data-block]")) if (el.getBoundingClientRect().bottom > 120) return el.dataset.block;
    return undefined;
  }, [cursor]);
  /** Stopping from inside the bar removes the bar, so keyboard focus would fall to the page: put it on the top-bar listen button (when the Listen setting shows one) or on the text. */
  const stopFromBar = useCallback(() => {
    const inBar = !!(document.activeElement as HTMLElement | null)?.closest('[data-listen-bar]');
    speech.stop();
    if (!inBar) return;
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>("[data-listen-toggle]") ?? rootRef.current;
      if (!target) return;
      if (!target.hasAttribute("tabindex") && target === rootRef.current) target.setAttribute("tabindex", "-1"); // the text itself, so Tab continues from there
      target.focus({ preventScroll: true });
    });
  }, [speech]);
  const readAloudUnavailable = useCallback(() => toast(tNow("reader.readAloudUnavailable"), { ttl: 6000 }), []);
  const startReading = useCallback(() => {
    if (!speech.supported) return readAloudUnavailable();
    speech.playFrom(readingStart());
  }, [speech, readingStart, readAloudUnavailable]);
  const readPassage = useCallback(
    (start: { b: string; o: number }, end: { b: string; o: number }, thenContinue = true) => {
      if (!speech.supported) return readAloudUnavailable();
      speech.playRange(start, end, thenContinue);
    },
    [speech, readAloudUnavailable],
  );

  /** Open the voice panel; read-aloud steps aside first, because the microphone would hear it and search for what it said. */
  const [voiceMode, setVoiceMode] = useState<"find" | "ask">("find");
  const openVoice = useCallback(
    (mode: "find" | "ask" = "find") => {
      speech.pause();
      setVoiceMode(mode);
      setVoiceOpen(true);
    },
    [speech],
  );

  useEffect(() => {
    if (!backTo) return;
    const t = window.setTimeout(() => setBackTo(null), 30_000);
    return () => window.clearTimeout(t);
  }, [backTo]);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "Escape") {
        if (pending) return clearSelection();
        if (findOpen) return closeFind();
        if (voiceOpen) return setVoiceOpen(false);
        if (keysOpen) return setKeysOpen(false);
        if (activeId) return setActiveId(null);
        if (insightsOpen) return setInsightsOpen(false);
        if (nbOpen) return setNbOpen(false);
        if (settings.focus) return setSettings({ focus: false });
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || pending) return;
      // A modal panel owns the keyboard: nothing behind it may react (j/k, L, Enter, Space...), except closing the shortcuts list with "?".
      if (voiceOpen || keysOpen) {
        if (e.key === "?" && keysOpen) setKeysOpen(false);
        return;
      }
      // Single-key shortcuts switched off (Appearance): only Enter on a focused paragraph, Escape and the buttons still work.
      if (!settings.keys && e.key !== "Enter") return;
      const numbered = blocks.filter((b) => b.n);
      const ci = numbered.findIndex((b) => b.id === cursor);
      switch (e.key) {
        case "/":
          e.preventDefault();
          composerRef.current?.focus();
          break;
        case "j":
        case "J": {
          e.preventDefault();
          const next = numbered[Math.min(numbered.length - 1, ci + 1)];
          if (next) scrollToBlock(next.id);
          break;
        }
        case "k":
        case "K": {
          e.preventDefault();
          const prev = numbered[Math.max(0, ci <= 0 ? 0 : ci - 1)];
          if (prev) scrollToBlock(prev.id);
          break;
        }
        case "Enter": {
          if (!cursor || document.activeElement !== document.body) break;
          e.preventDefault();
          const el = blockEl(cursor);
          const a = blockAnchor(cursor);
          if (el && a) {
            dismissRef.current = false;
            setPending({ anchor: a, rect: el.getBoundingClientRect() });
          }
          break;
        }
        case "[":
        case "]": {
          e.preventDefault();
          if (!glosses.length) break;
          const i = glosses.findIndex((g) => g.id === activeId);
          const n = e.key === "]" ? (i + 1) % glosses.length : (i - 1 + glosses.length) % glosses.length;
          setActiveId(glosses[n].id);
          if (glosses[n].anchor) jumpToAnchor(glosses[n].anchor!);
          break;
        }
        case "b":
        case "B":
          createGloss("overview", null);
          break;
        case "n":
        case "N":
          toggleNotebook();
          break;
        case "i":
        case "I":
          toggleInsights();
          break;
        case "f":
        case "F":
          setSettings({ focus: !settings.focus });
          break;
        case "s":
        case "S":
          e.preventDefault();
          openFind();
          break;
        case "l":
        case "L":
          if (snap.state === "playing" || snap.state === "paused") speech.stop();
          else startReading();
          break;
        case " ":
          // Space belongs to the focused control (buttons, links, menus); only a bare page lets it pause or resume.
          if ((snap.state === "playing" || snap.state === "paused") && !t?.closest("button, a[href], summary, [role=button], [role=menuitem], [role=menuitemradio], [role=option], [role=slider], [role=toolbar]")) {
            e.preventDefault();
            speech.toggle();
          }
          break;
        case "v":
        case "V":
          openVoice();
          break;
        case "?":
          setKeysOpen((v) => !v);
          break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, voiceOpen, keysOpen, activeId, nbOpen, insightsOpen, findOpen, closeFind, openFind, toggleNotebook, toggleInsights, settings.focus, settings.keys, setSettings, blocks, cursor, glosses, clearSelection, scrollToBlock, blockAnchor, blockEl, jumpToAnchor, createGloss, snap.state, speech, startReading, openVoice]);

  /* ---------- marks per block ---------- */
  const marks = useMemo(() => {
    const list: { id: string; kind: string; anchor: Anchor; data?: Record<string, string | undefined> }[] = [];
    for (const { item: a, anchor } of resolvedAnn) {
      if (!anchor) continue; // orphaned: no mark (it is listed as "couldn't find this passage" instead)
      list.push({ id: a.id, kind: a.kind === "highlight" ? "hl" : a.kind === "underline" ? "ul" : "note", anchor, data: { color: a.color ?? "yellow", state: a.id === activeId ? "is-active" : "" } });
    }
    for (const { item: g, anchor } of resolvedGl) {
      if (!anchor) continue;
      list.push({ id: g.id, kind: "gloss", anchor, data: { state: `${g.id === activeId ? "is-active" : ""} ${g.id === hoverId ? "is-hover" : ""} ${g.status === "streaming" ? "is-new" : ""}` } });
    }
    if (pending) list.push({ id: "pending", kind: "pending", anchor: pending.anchor });
    if (hit) list.push({ id: "hit", kind: "hit", anchor: hit });
    // Matches of the literal search: the first 500 are marked (the count shows all), and the current one always is.
    const markFind = (i: number, current: boolean) => {
      const m = found.matches[i];
      const b = blocks[blockIdx.get(m.blockId) ?? -1];
      if (b) list.push({ id: `find-${i}`, kind: current ? "find-cur" : "find", anchor: { start: { b: m.blockId, o: m.start }, end: { b: m.blockId, o: m.end }, quote: b.text.slice(m.start, m.end) } });
    };
    const cur = Math.min(findCur, found.matches.length - 1);
    for (let i = 0; i < Math.min(found.matches.length, 500); i++) markFind(i, i === cur);
    if (cur >= 500) markFind(cur, true);
    if (snap.segment && (snap.state === "playing" || snap.state === "paused")) {
      const s = snap.segment;
      list.push({ id: "speak", kind: "speak", anchor: { start: { b: s.blockId, o: s.start }, end: { b: s.blockId, o: s.end }, quote: s.text } });
    }
    return list;
  }, [resolvedAnn, resolvedGl, activeId, hoverId, pending, hit, snap.segment, snap.state, found, findCur, blocks, blockIdx]);
  const segmentsByBlock = useMemo(() => {
    const m = new Map<string, ReturnType<typeof segmentBlock>>();
    for (const b of blocks) {
      const segs = segmentBlock(b, blocks, marks, blockIdx);
      if (segs.length > 1 || segs[0]?.marks.length) m.set(b.id, segs);
    }
    return m;
  }, [blocks, blockIdx, marks]);
  const noteBlocks = useMemo(() => new Set(resolvedAnn.filter((r) => r.item.kind === "note" && r.anchor).map((r) => r.anchor!.start.b)), [resolvedAnn]);
  const railMarks = useMemo(() => resolvedAnn.filter((r) => r.anchor).map((r) => ({ blockId: r.anchor!.start.b, color: r.item.color })), [resolvedAnn]);
  const layoutKey = `${resizeTick}:${marks.length}:${settings.size}:${settings.face}:${settings.width}:${settings.leading}`;

  useEffect(() => {
    const root = rootRef.current;
    const first = root?.querySelector<HTMLElement>(".prose-read .blk");
    const margin = root?.querySelector<HTMLElement>(".rg-margin");
    if (first && margin) setFirstTop(Math.max(0, first.getBoundingClientRect().top - margin.getBoundingClientRect().top));
  }, [layoutKey]);

  const marginItems: MarginItem[] = useMemo(
    () => [
      ...resolvedGl.map((r) => ({ id: r.item.id, kind: "gloss" as const, gloss: r.item, anchor: r.anchor, orphaned: r.status === "orphaned" })),
      // Notes sit next to their passage; anything whose passage cannot be found (of any kind) goes to the "couldn't find this passage" group.
      ...resolvedAnn.filter((r) => r.item.kind === "note" || r.status === "orphaned").map((r) => (r.status === "orphaned" ? { id: r.item.id, kind: "orphan" as const, note: r.item, anchor: null, orphaned: true } : { id: r.item.id, kind: "note" as const, note: r.item, anchor: r.anchor, orphaned: false })),
    ],
    [resolvedGl, resolvedAnn],
  );

  const onMarkClick = useCallback(
    (id: string, kind: string, e: React.MouseEvent) => {
      if (kind === "gloss" || kind === "note") {
        e.stopPropagation();
        setActiveId((cur) => (cur === id ? null : id));
        return;
      }
      if (kind === "hl" || kind === "ul") {
        // A click that ends a drag-selection must not replace what the reader just selected, and with nested marks only the innermost one answers.
        if (document.getSelection()?.isCollapsed === false) return;
        const inner = (e.target as Element).closest?.(".m-hl, .m-ul") as HTMLElement | null;
        if (inner && inner.dataset.mark !== id) return;
        // The resolved anchor (where the text is now), not the stored one: they differ after the text moved.
        const anchor = resolvedAnn.find((x) => x.item.id === id)?.anchor;
        if (!anchor) return;
        const range = rangeForAnchor(rootRef.current!, anchor);
        if (range) {
          const sel = document.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }
    },
    [resolvedAnn],
  );

  const onHitJump = useCallback(
    (h: Hit) => {
      const a: Anchor = { start: { b: h.blockId, o: h.start }, end: { b: h.blockId, o: h.end }, quote: h.excerpt };
      setHit(a);
      scrollToBlock(h.blockId, true);
      window.setTimeout(() => setHit((x) => (x === a ? null : x)), 6000);
    },
    [scrollToBlock],
  );
  const onHitRead = useCallback(
    (h: Hit) => {
      onHitJump(h);
      // "Read that passage" reads that passage; it does not carry on through the rest of the text.
      readPassage({ b: h.blockId, o: h.start }, { b: h.blockId, o: h.end }, false);
    },
    [onHitJump, readPassage],
  );

  const listening = snap.state === "playing" || snap.state === "paused";
  const firstN = blocks.find((b) => b.n)?.id;
  const rootClass = ["relative z-[1]", settings.numbers ? "" : "hide-nums", settings.focus ? "focus-mode" : "", nbOpen || insightsOpen ? "nb-open" : ""].filter(Boolean).join(" ");

  return (
    <div className={rootClass} data-lens-docked={pending ? "" : undefined} data-reader-ready={mounted ? "" : undefined}>
      <Topbar
        variant="reader"
        className={scrolled ? "border-rule bg-[color-mix(in_oklab,var(--bg)_86%,transparent)] backdrop-blur-md" : ""}
        progress={ratio}
        after={
          <>
          <IconButton aria-pressed={findOpen} active={findOpen} aria-label={t("reader.find")} data-tip={t("reader.find")} data-tip-kbd="S" onClick={() => (findOpen ? closeFind() : openFind())}>
            <Search size={16} strokeWidth={1.8} aria-hidden="true" />
          </IconButton>
          <IconButton className="relative !px-3 max-sm:w-9 max-sm:!px-0" aria-pressed={insightsOpen} active={insightsOpen} data-tip={insightsOpen ? t("common.close") : t("reader.understandTip")} data-tip-kbd="I" onClick={toggleInsights}>
            <BookOpenCheck size={16} strokeWidth={1.8} aria-hidden="true" />
            <span className="hidden sm:inline">{t("reader.understand")}</span>
            <span className="sr-only sm:hidden">{t("reader.understand")}</span>
            {insights.length ? <span className="min-w-[18px] rounded-full bg-sunk px-1.5 text-center text-[11px] font-semibold leading-[18px] tabular-nums text-ink-2 max-sm:absolute max-sm:-right-0.5 max-sm:-top-0.5 max-sm:min-w-[16px] max-sm:px-1 max-sm:text-[10px] max-sm:leading-[16px]">{insights.length}</span> : null}
          </IconButton>
          <IconButton className="relative !px-3 max-sm:w-9 max-sm:!px-0" aria-pressed={nbOpen} active={nbOpen} data-tip={nbOpen ? t("reader.closeNotebook") : t("reader.notesTip")} data-tip-kbd="N" onClick={toggleNotebook}>
            <NotebookPen size={16} strokeWidth={1.8} aria-hidden="true" />
            <span className="hidden sm:inline">{t("reader.notebook")}</span>
            <span className="sr-only sm:hidden">{t("reader.notebook")}</span>
            {annotations.length + glosses.length ? <span className="min-w-[18px] rounded-full bg-[var(--rubric)] px-1.5 text-center text-[11px] font-semibold leading-[18px] tabular-nums text-white max-sm:absolute max-sm:-right-0.5 max-sm:-top-0.5 max-sm:min-w-[16px] max-sm:px-1 max-sm:text-[10px] max-sm:leading-[16px]">{annotations.length + glosses.length}</span> : null}
          </IconButton>
          </>
        }
        center={
          <div className={`flex min-w-0 flex-1 justify-center transition-opacity duration-300 ${scrolled ? "opacity-100" : "pointer-events-none opacity-0"}`}>
            <div className="hidden h-9 min-w-0 max-w-[560px] items-center gap-2 text-[13.5px] md:flex">
              <button type="button" className="min-w-0 truncate rounded-full px-2.5 py-1.5 font-serif text-[16px] leading-none text-ink transition-colors hover:bg-sunk" data-tip={t("reader.backToTop")} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
                {doc.title}
              </button>
            </div>
          </div>
        }
        tools={
          <>
            <span className="hidden sm:block">
              <IconButton aria-label={t("reader.shortcutsLabel")} data-tip={t("reader.shortcuts")} data-tip-kbd="?" onClick={() => setKeysOpen(true)}>
                <Keyboard size={17} strokeWidth={1.8} aria-hidden="true" />
              </IconButton>
            </span>
            {settings.listen && !(mounted && snap.state === "unsupported") ? (
              <IconButton
                aria-label={listening ? t("reader.stopReading") : t("reader.readAloud")}
                active={listening}
                data-tip={listening ? t("reader.stopReading") : t("reader.readAloud")}
                data-tip-kbd="L"
                data-listen-toggle=""
                onClick={() => (listening ? speech.stop() : startReading())}
              >
                <Headphones size={16} strokeWidth={1.8} aria-hidden="true" />
              </IconButton>
            ) : null}
          </>
        }
      />
      <main ref={rootRef} className="relative z-[1] outline-none px-4 pb-10 pt-[calc(var(--topbar-h)+64px)] sm:px-6">
        <div className="reader-grid">
          <div className="rg-rail relative">
            <div className="sticky top-[calc(var(--topbar-h)+28px)] h-[calc(100dvh-var(--topbar-h)-64px)]">
              {settings.rail ? <Rail blocks={blocks} rootRef={rootRef} progress={ratio} marks={railMarks} /> : null}
            </div>
          </div>
          <div className="rg-numgap" aria-hidden="true" />
          <div className="min-w-0">
            <header className="mb-14">
              <p className="focus-hide rise mb-6 flex items-center gap-2 text-[13px] font-medium text-ink-3">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--rubric)]" />
                <span className="truncate">{doc.sourceLabel || (doc.kind === "pdf" ? t("reader.kindPdf") : doc.kind === "text" ? t("reader.kindText") : t("reader.kindArticle"))}</span>
              </p>
              <h1 className="rise font-serif text-[clamp(2.6rem,6.4vw,4.3rem)] font-[380] leading-[1.02] tracking-[-0.022em] text-balance text-ink [font-variation-settings:'opsz'_72]" style={{ animationDelay: "40ms" }}>
                {doc.title}
              </h1>
              {doc.dek ? (
                <p className="focus-hide rise mt-5 max-w-[38rem] text-[clamp(1.05rem,1.7vw,1.19rem)] leading-[1.55] text-pretty text-ink-2" style={{ animationDelay: "90ms" }}>
                  {doc.dek}
                </p>
              ) : null}
              <div className="focus-hide rise mt-8 flex items-center gap-4 border-t border-rule pt-5" style={{ animationDelay: "140ms" }}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] leading-snug text-ink">
                    {doc.author ? <span className="font-medium">{doc.author}</span> : <span className="font-medium text-ink-3">{t("reader.unknownAuthor")}</span>}
                    {doc.year ? <span className="text-ink-3">&nbsp;&nbsp;·&nbsp;&nbsp;{doc.year}</span> : null}
                  </p>
                  <p className="mt-1 text-[13px] leading-snug text-ink-3">
                    {doc.minutes} min read <span className="text-ink-4">·</span> {doc.paragraphs} paragraphs
                  </p>
                </div>
                {doc.sourceUrl ? (
                  <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-rule px-3.5 text-[13px] font-medium text-ink-2 transition-[border-color,color,transform] hover:border-rule-strong hover:text-ink active:scale-[0.97]">
                    Original <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                ) : null}
              </div>
              <div className="focus-hide rise" style={{ animationDelay: "200ms" }}>
                <button
                  type="button"
                  className="group mt-6 flex w-full items-center gap-5 rounded-[16px] border border-rule bg-raised/60 py-4 pl-5 pr-4 text-left transition-[border-color,background-color,transform,box-shadow] duration-200 hover:border-rule-strong hover:bg-raised hover:shadow-card active:scale-[0.995]"
                  onClick={() => createGloss("overview", null)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-serif text-[19px] leading-none tracking-[-0.01em] text-ink [font-variation-settings:'opsz'_24]">
                      {t("reader.glossThis")}
                      <ArrowRight size={15} aria-hidden="true" className="translate-y-px text-ink-4 transition-[transform,color] duration-300 ease-[var(--ease-out)] group-hover:translate-x-1 group-hover:text-rubric-text" />
                    </span>
                    <span className="mt-1.5 block truncate text-[13px] leading-snug text-ink-3">{t("reader.glossThisHelp")}</span>
                  </span>
                  <kbd className="hidden sm:inline">B</kbd>
                </button>
              </div>
            </header>

            <div className="prose-read">
              {blocks.map((b) => (
                <Block
                  key={b.id}
                  block={b}
                  first={b.id === firstN}
                  cursor={cursor === b.id}
                  speaking={snap.segment?.blockId === b.id && listening}
                  flash={flash === b.id}
                  read={readSet.has(b.id)}
                  segments={segmentsByBlock.get(b.id) ?? []}
                  onAsk={(id) => {
                    const el = blockEl(id);
                    const a = blockAnchor(id);
                    if (el && a) {
                      setCursor(id);
                      dismissRef.current = false;
                      setPending({ anchor: a, rect: el.getBoundingClientRect() });
                    }
                  }}
                  onMarkClick={onMarkClick}
                  onMarkHover={(id) => setHoverId(id)}
                  hasNote={noteBlocks.has(b.id)}
                />
              ))}
            </div>

            <footer className="focus-hide mt-16 border-t border-rule pt-10 text-[13.5px] leading-relaxed text-ink-3">
              <p aria-hidden="true" className="mb-8 text-center font-serif text-[26px] leading-none text-[var(--rubric)]">
                ❦
              </p>
              <p>
                {t("reader.footerFrom", { source: doc.sourceLabel || t("reader.yourOwnText") })}
                {doc.kind === "sample" ? t("reader.publicDomain") : ""}.
              </p>
              <p className="mt-1">
                {serverInfo?.model ? (
                  <>
                    {t("reader.footerWrittenBy", { model: serverInfo.model.split("/").pop() ?? "" })}{" "}
                    <a href="https://www.together.ai" target="_blank" rel="noopener noreferrer" className="text-ink-2 underline decoration-rule-strong underline-offset-4 hover:text-ink">
                      Together AI
                    </a>
                    {serverInfo.serverKey ? "" : t("reader.withOwnKey")}.
                  </>
                ) : (
                  t("reader.footerOpenModel")
                )}{" "}
                {t("reader.voices")}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <button type="button" className="h-9 rounded-full border border-rule px-4 text-[13px] font-medium text-ink-2 hover:border-rule-strong hover:text-ink" onClick={() => { setInsightsOpen(false); setNbOpen(true); }}>
                  {t("reader.openNotebook")}
                </button>
                <Link className="inline-flex h-9 items-center rounded-full border border-rule px-4 text-[13px] font-medium text-ink-2 hover:border-rule-strong hover:text-ink" href="/library">
                  {t("reader.backToLibrary")}
                </Link>
              </div>
              <QuickAdd />
            </footer>

            <Composer ref={composerRef} onAsk={(q) => createGloss("whole", null, q)} web={settings.search} onWebToggle={() => setSettings({ search: !settings.search })} onVoice={() => openVoice("ask")} />
          </div>
          <div className="rg-gutter" aria-hidden="true" />
          <div className="rg-margin min-w-0">
            {!sheet ? (
              <MarginGlosses
                items={marginItems}
                blocks={blocks}
                rootRef={rootRef}
                activeId={activeId}
                hoverId={hoverId}
                layoutKey={layoutKey}
                onActivate={(id) => setActiveId(id)}
                onHover={setHoverId}
                onDeleteGloss={deleteGloss}
                onRetry={retry}
                onFollowUp={followUp}
                onCite={onCite}
                citeSet={citeSetFor}
                onEditNote={(id, t) => updateAnnotation(documentId, id, { note: t })}
                onDeleteNote={(id) => {
                  removeAnnotation(documentId, id);
                  if (activeId === id) setActiveId(null);
                }}
                sheet={false}
                emptyTop={firstTop}
              />
            ) : null}
          </div>
        </div>
      </main>

      {sheet ? (
        <MarginGlosses items={marginItems} blocks={blocks} rootRef={rootRef} activeId={activeId} hoverId={hoverId} layoutKey={layoutKey} onActivate={setActiveId} onHover={setHoverId} onDeleteGloss={deleteGloss} onRetry={retry} onFollowUp={followUp} onCite={onCite} citeSet={citeSetFor} onEditNote={(id, t) => updateAnnotation(documentId, id, { note: t })} onDeleteNote={(id) => { removeAnnotation(documentId, id); setActiveId(null); }} sheet />
      ) : null}

      {pending ? (
        <aside aria-label={t("reader.selectionTools")}>
        <Lens
          rect={pending.rect}
          marker={settings.marker}
          keyShortcuts={settings.keys}
          onAction={(a, q) => createGloss(a, pending.anchor, q)}
          onHighlight={(c) => {
            setSettings({ marker: c });
            annotate("highlight", c);
          }}
          onUnderline={(c) => annotate("underline", c)}
          existing={pendingMarks.map((a) => ({ id: a.id, kind: a.kind === "underline" ? ("underline" as const) : ("highlight" as const) }))}
          onRemove={(ids) => {
            ids.forEach((id) => removeAnnotation(documentId, id));
            clearSelection();
            toast(tNow("reader.removed"), { ttl: 2200 });
          }}
          onNote={(t) => annotate("note", settings.marker, t)}
          onCopy={() => {
            const n = blocks.find((b) => b.id === pending.anchor.start.b)?.n;
            void navigator.clipboard?.writeText(`“${pending.anchor.quote}”\n— ${doc.title}${doc.author ? `, ${doc.author}` : ""}${n ? `, ¶${n}` : ""}`);
            toast(tNow("reader.copied"), { ttl: 2500 });
            clearSelection();
          }}
          onListen={() => {
            readPassage(pending.anchor.start, pending.anchor.end);
            clearSelection();
          }}
          onTranslate={() => {
            runPassageOp("translate", pending.anchor);
            clearSelection();
          }}
          onSummarize={() => {
            runPassageOp("summarize", pending.anchor);
            clearSelection();
          }}
          onClose={clearSelection}
        />
        </aside>
      ) : null}

      {backTo ? (
        <button
          type="button"
          className="fixed bottom-[88px] left-4 z-[43] flex h-9 items-center gap-2 rounded-full border border-rule bg-raised px-3.5 text-[13px] font-medium text-ink-2 shadow-pop hover:text-ink"
          style={{ animation: "sheet-in 0.25s var(--ease-out)" }}
          onClick={() => {
            window.scrollTo({ top: backTo.y, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
            setBackTo(null);
          }}
        >
          <ArrowUp size={14} aria-hidden="true" /> {t("reader.backToWhere")}
        </button>
      ) : null}
      {findOpen ? (
        <FindBar
          query={findQuery}
          onQuery={(q) => {
            setFindQuery(q);
            setFindCur(0);
          }}
          total={found.matches.length}
          current={Math.min(findCur, Math.max(0, found.matches.length - 1))}
          truncated={found.truncated}
          onNext={() => stepFind(1)}
          onPrev={() => stepFind(-1)}
          onClose={closeFind}
          sections={sectionList}
          onSection={(s: Section) => scrollToBlock(s.blockId, true)}
          onAskMeaning={() => {
            closeFind();
            openVoice();
          }}
        />
      ) : null}
      <InsightsPanel
        open={insightsOpen}
        onClose={() => setInsightsOpen(false)}
        doc={doc}
        insights={insights}
        hasKey={hasAnyKey(!!serverInfo?.serverKey)}
        outputLang={settings.outLang}
        onOutputLang={(c) => setSettings({ outLang: c })}
        targetLang={targetLang}
        onTargetLang={(c) => setSettings({ targetLang: c })}
        onRun={(op, v) => runDocumentOp(op, v)}
        docHash={docHash}
        focusId={focusInsight}
        onRegenerate={(g) => {
          const how = regenerable(g);
          if (how) runDocumentOp(how.op, how.variant, 0, true);
        }}
        onTranslatePart={translatePart}
        onContinue={continueSummary}
        onJumpEvidence={jumpToEvidence}
        onDelete={cancelInsight}
        onRetry={retryInsight}
        onCancel={cancelInsight}
      />
      <Notebook
        open={nbOpen}
        onClose={() => setNbOpen(false)}
        doc={doc}
        blocks={blocks}
        annotations={resolvedAnn}
        glosses={resolvedGl}
        onJump={(a) => {
          jumpToAnchor(a);
          if (sheet) setNbOpen(false);
        }}
        onOpenGloss={(id) => {
          setActiveId(id);
          const g = glosses.find((x) => x.id === id);
          if (g?.anchor) jumpToAnchor(g.anchor);
          if (sheet) setNbOpen(false);
        }}
        onRemoveAnnotation={(id) => removeAnnotation(documentId, id)}
        onDeleteGloss={deleteGloss}
        onCite={onCite}
        citeSet={citeSetFor}
        persisted={lib.persisted}
      />
      <ListenBar snap={snap} voices={speech.getVoices()} onToggle={() => speech.toggle()} onStop={stopFromBar} onRestart={() => speech.restart()} onSkip={(d) => {
        followSpeech.current = true;
        speech.skip(d);
      }} onRate={(r) => setSettings({ rate: r })} onVoice={(v) => setSettings({ voice: v })} docLang={docLang} />
      {voiceOpen ? (
        <VoiceSearch
          open
          onClose={() => setVoiceOpen(false)}
          blocks={blocks}
          lang={docLang}
          onJump={onHitJump}
          onRead={onHitRead}
          onListenStart={() => speech.pause()}
          serverKey={!!serverInfo?.serverKey}
          initialMode={voiceMode}
          onAsk={askByVoice}
          conversation={voiceConversation}
          onNewConversation={() => setVoiceGlossId(null)}
          onShowAnswer={(id) => setActiveId(id)}
          onCite={onCite}
          voice={{ rate: settings.rate, voiceURI: settings.voice, lang: docLang }}
          onAnswerSpeak={() => speech.stop()}
        />
      ) : null}
      <KeysDialog open={keysOpen} onClose={() => setKeysOpen(false)} />
      <Toasts bottom={snap.state === "idle" || snap.state === "unsupported" ? 84 : 150} />
    </div>
  );
}
