"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Library, LayoutGrid, Link2, Plus, Search } from "lucide-react";
import type { GlossDocument } from "@/lib/content/types";
import { TOPICS, topicInfo } from "@/lib/content/types";
import { SAMPLES } from "@/lib/content/samples";
import { hideSample, rememberDocument, removeDocument, syncRemoteLibrary, updateDocumentMeta, useLibrary } from "@/lib/store/library";
import { toast } from "@/lib/store/toast";
import { getSettings } from "@/lib/store/settings";
import { Topbar } from "@/components/chrome/Topbar";
import { Toasts } from "@/components/chrome/Toasts";
import { Spine } from "./Spine";
import { TopicArt, TopicGlyph } from "./TopicGlyph";
import { OpenBook } from "./OpenBook";
import { AddPanel } from "./AddPanel";
import { LibrarySearch } from "./LibrarySearch";
import { BackupPanel } from "./BackupPanel";
import { EMPTY_SEARCH, searchLibrary } from "@/lib/search/library";
import { layoutShelf, shortAuthor, spineFor, type Sort } from "./shelf";

type Meta = Omit<GlossDocument, "blocks">;

export function LibraryPage({ serverDocs }: { serverDocs: Meta[] }) {
  const lib = useLibrary();
  const [view, setView] = useState<"shelf" | "topics">("shelf");
  const [sort, setSort] = useState<Sort>("topic");
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<{ slug: string; rect: DOMRect | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const [entering, setEntering] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const [chipEdges, setChipEdges] = useState({ l: false, r: false });

  useEffect(() => {
    void syncRemoteLibrary();
    // Seed the three samples onto the shelf the first time (they are not stored anywhere else).
    try {
      if (!localStorage.getItem("gloss:library-seen")) {
        for (const s of SAMPLES) rememberDocument(s, true);
        localStorage.setItem("gloss:library-seen", String(Date.now()));
      }
    } catch {
      /* ignore */
    }
    const t = window.setTimeout(() => setEntering(false), 1200);
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "/" && getSettings().keys && !(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA"))) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const hidden = useMemo(() => new Set(lib.hidden), [lib.hidden]);
  // Merge: local store (includes samples + local-only docs) and server docs.
  const docs: Meta[] = useMemo(() => {
    const map = new Map<string, Meta>();
    for (const s of SAMPLES) if (!hidden.has(s.slug)) map.set(s.slug, { ...s, blocks: undefined } as unknown as Meta);
    for (const d of serverDocs) map.set(d.slug, d);
    for (const d of Object.values(lib.docs)) {
      if (hidden.has(d.slug)) continue;
      const { blocks: _b, ...meta } = d;
      void _b;
      map.set(d.slug, { ...(map.get(d.slug) ?? {}), ...meta });
    }
    return [...map.values()];
  }, [lib.docs, serverDocs, hidden]);

  // Every text whose words are in this browser (a sample or a text kept only here), for "where did I read about this?".
  const searchable = useMemo(() => {
    const out: GlossDocument[] = [];
    const seen = new Set<string>();
    for (const d of Object.values(lib.docs)) {
      if (hidden.has(d.slug)) continue;
      const sample = SAMPLES.find((s) => s.slug === d.slug);
      out.push(d.blocks.length ? d : sample ? { ...d, blocks: sample.blocks } : d);
      seen.add(d.slug);
    }
    for (const s of SAMPLES) if (!hidden.has(s.slug) && !seen.has(s.slug)) out.push(s);
    return out;
  }, [lib.docs, hidden]);
  const deferredQuery = useDeferredValue(query);
  const found = useMemo(() => {
    if (!deferredQuery.trim()) return EMPTY_SEARCH;
    const r = searchLibrary(searchable, (d) => (d.id ? (lib.annotations[d.id] ?? []) : []), deferredQuery);
    // Texts only on the account have no words here; they are the shelf documents without a searchable copy.
    const have = new Set(searchable.filter((d) => d.blocks.length).map((d) => d.slug));
    return { ...r, unsearched: docs.filter((d) => !have.has(d.slug)).length };
  }, [searchable, lib.annotations, deferredQuery, docs]);

  const progressOf = (d: Meta) => (d.id ? lib.progress[d.id] : undefined);
  const q = query.trim().toLowerCase();
  const filtered = docs.filter((d) => {
    if (q && !`${d.title} ${d.author ?? ""} ${d.sourceLabel ?? ""}`.toLowerCase().includes(q)) return false;
    if (filter === "all") return true;
    if (filter === "reading") return !!progressOf(d) && (progressOf(d)!.ratio ?? 0) > 0.02 && !progressOf(d)!.finished;
    if (filter === "finished") return !!progressOf(d)?.finished;
    if (filter === "short") return (d.minutes ?? 0) < 10;
    return d.topic === filter;
  });

  const topics = TOPICS.map((t) => ({ ...t, count: docs.filter((d) => d.topic === t.id).length })).filter((t) => t.count > 0);
  const minutes = docs.reduce((n, d) => n + (d.minutes ?? 0), 0);
  const reading = docs.filter((d) => (progressOf(d)?.ratio ?? 0) > 0.02 && !progressOf(d)?.finished).length;
  const finished = docs.filter((d) => progressOf(d)?.finished).length;
  const shortCount = docs.filter((d) => (d.minutes ?? 0) < 10).length;

  const layout = useMemo(() => layoutShelf(filtered, sort, lib.progress), [filtered, sort, lib.progress]);
  const openDoc = open ? docs.find((d) => d.slug === open.slug) : null;

  useEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    const upd = () => setChipEdges({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    upd();
    el.addEventListener("scroll", upd, { passive: true });
    window.addEventListener("resize", upd);
    return () => {
      el.removeEventListener("scroll", upd);
      window.removeEventListener("resize", upd);
    };
  }, [topics.length]);

  const hours = minutes >= 60 ? `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? "" : "s"} of reading` : `${minutes} min of reading`;

  return (
    <div className="library relative z-[1] min-h-dvh transition-[opacity,filter] duration-300">
      <div className="lib-top">
        <Topbar variant="library" onAdd={() => setAdding(true)} />
      </div>
      <main className="mx-auto w-full max-w-[1180px] px-4 pb-32 sm:px-8">
        <section className="lib-hero">
          <div className="lib-hero-row">
            <div className="min-w-0">
              <h1 className="lib-title">Your library</h1>
              <p className="lib-stats">
                <span>
                  <b>{docs.length}</b> text{docs.length === 1 ? "" : "s"}
                </span>
                <span>
                  <b>{topics.length}</b> topic{topics.length === 1 ? "" : "s"}
                </span>
                <span>
                  <b>{minutes >= 60 ? Math.round(minutes / 60) : minutes}</b> {hours.replace(/^\d+ /, "")}
                </span>
                {reading ? (
                  <span>
                    <b>{reading}</b> in progress
                  </span>
                ) : null}
                {finished ? (
                  <span>
                    <b>{finished}</b> read
                  </span>
                ) : null}
              </p>
            </div>
            <button type="button" className="lib-add" onClick={() => setAdding(true)}>
              <span className="mark-stack" aria-hidden="true" style={{ ["--mark" as string]: "26px" }}>
                <span className="mark-disc" style={{ zIndex: 1 }}>
                  <Link2 size={14} aria-hidden="true" />
                </span>
                <span className="mark-disc" style={{ zIndex: 2 }}>
                  <TopicGlyph topic="writing" size={15} />
                </span>
                <span className="mark-disc" style={{ zIndex: 3 }}>
                  <TopicGlyph topic="ai" size={15} />
                </span>
              </span>
              <span className="min-w-0 text-left">
                <span className="lib-add-title">Add articles</span>
                <span className="lib-add-sub">Paste links, or open a PDF</span>
              </span>
              <span className="lib-add-plus" aria-hidden="true">
                <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
              </span>
            </button>
          </div>
        </section>

        <div className="lib-tools">
          <div className="lib-switch" role="radiogroup" aria-label="View" data-view={view}>
            <span className="lib-switch-pill" aria-hidden="true" />
            <button type="button" role="radio" aria-checked={view === "shelf"} onClick={() => setView("shelf")}>
              <Library size={15} aria-hidden="true" /> Shelf
            </button>
            <button type="button" role="radio" aria-checked={view === "topics"} onClick={() => setView("topics")}>
              <LayoutGrid size={15} aria-hidden="true" /> Topics
            </button>
          </div>
          <label className="lib-search">
            <Search size={15} aria-hidden="true" className="shrink-0 text-ink-4" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // From the box straight into the results, without tabbing past the shelf controls.
                if (e.key === "ArrowDown") {
                  const first = document.querySelector<HTMLElement>("[data-libs-item]");
                  if (first) {
                    e.preventDefault();
                    first.focus();
                  }
                }
              }}
              placeholder="Search the library"
              aria-label="Search the library"
            />
            <kbd className="max-sm:hidden">/</kbd>
          </label>
          {view === "shelf" ? (
            <div className="lib-sort" role="radiogroup" aria-label="Arrange by">
              <span className="px-2 text-[12.5px] text-ink-4 max-md:hidden">Arrange by</span>
              {(["topic", "recent", "colour", "length"] as Sort[]).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={sort === s} onClick={() => setSort(s)}>
                  {s[0].toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {view === "shelf" ? (
          <div className="lib-chip-row" data-l={chipEdges.l ? "" : undefined} data-r={chipEdges.r ? "" : undefined}>
            <div ref={chipsRef} className="lib-chips no-scrollbar" role="group" aria-label="Filter">
              <button type="button" aria-pressed={filter === "all"} className="lib-chip" onClick={() => setFilter("all")}>
                All <span className="lib-n">{docs.length}</span>
              </button>
              {topics.map((t) => (
                <button key={t.id} type="button" aria-pressed={filter === t.id} className="lib-chip" style={{ ["--c" as string]: t.color }} onClick={() => setFilter(filter === t.id ? "all" : t.id)}>
                  <TopicGlyph topic={t.id} size={18} /> {t.label} <span className="lib-n">{t.count}</span>
                </button>
              ))}
              {reading || finished || shortCount ? <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 self-center bg-rule-strong" /> : null}
              {reading ? (
                <button type="button" aria-pressed={filter === "reading"} className="lib-chip" onClick={() => setFilter(filter === "reading" ? "all" : "reading")}>
                  <span className="lib-emoji">📕</span> Reading now <span className="lib-n">{reading}</span>
                </button>
              ) : null}
              {finished ? (
                <button type="button" aria-pressed={filter === "finished"} className="lib-chip" onClick={() => setFilter(filter === "finished" ? "all" : "finished")}>
                  <span className="lib-emoji">✅</span> Finished <span className="lib-n">{finished}</span>
                </button>
              ) : null}
              {shortCount ? (
                <button type="button" aria-pressed={filter === "short"} className="lib-chip" onClick={() => setFilter(filter === "short" ? "all" : "short")}>
                  <span className="lib-emoji">⚡</span> Under 10 min <span className="lib-n">{shortCount}</span>
                </button>
              ) : null}
            </div>
            <button type="button" className="lib-chip-page is-l" aria-label="Scroll filters left" tabIndex={-1} onClick={() => chipsRef.current?.scrollBy({ left: -240, behavior: "smooth" })}>
              <ChevronLeft size={15} aria-hidden="true" />
            </button>
            <button type="button" className="lib-chip-page is-r" aria-label="Scroll filters right" tabIndex={-1} onClick={() => chipsRef.current?.scrollBy({ left: 240, behavior: "smooth" })}>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {query.trim().length >= 2 ? <LibrarySearch query={deferredQuery} result={found} titleMatches={filtered.length} /> : null}

        <div className="lib-screen">
          {view === "shelf" ? (
            <>
              <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <div className={`bookcase ${entering ? "is-entering" : ""}`} style={{ height: layout.height, minWidth: Math.min(layout.width, 1180) }}>
                  <div className="plank" aria-hidden="true" style={{ transform: `translateY(${layout.shelfY}px)`, ["--i" as string]: 0 }} />
                  {layout.labels.map((l) => (
                    <button key={l.topic} type="button" className="plank-label" data-tip={`Open ${topicInfo(l.topic).label}`} style={{ transform: `translate(${l.x}px, ${layout.shelfY + 24}px)` }} onClick={() => setFilter(l.topic)}>
                      <TopicGlyph topic={l.topic} size={16} className="mr-[5px]" />
                      {topicInfo(l.topic).label}
                      <span className="plank-n">{l.count}</span>
                    </button>
                  ))}
                  <div className="bookend" aria-hidden="true" style={{ transform: `translate(${layout.bookendX}px, ${layout.shelfY - 64}px)` }}>
                    <svg viewBox="0 0 30 64" width="30" height="64">
                      <defs>
                        <linearGradient id="bookend-shade" x1="0" x2="1">
                          <stop offset="0" stopColor="#fff" stopOpacity=".22" />
                          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
                          <stop offset="1" stopColor="#000" stopOpacity=".18" />
                        </linearGradient>
                      </defs>
                      <path d="M3 64V24C3 12 11 3 23 3h3v61z" fill="currentColor" />
                      <path d="M3 64V24C3 12 11 3 23 3h3v61z" fill="url(#bookend-shade)" />
                    </svg>
                  </div>
                  <div className="shelf-plant" aria-hidden="true" style={{ transform: `translate(${Math.max(layout.bookendX + 180, 996)}px, ${layout.shelfY - 132}px)` }}>
                    <svg viewBox="0 0 92 132" width="92" height="132">
                      <g className="plant-leaves">
                        <path d="M46 84C44 60 30 44 12 40c4 20 16 36 34 44z" fill="#5f8a55" />
                        <path d="M46 84c2-26 14-46 34-52-2 24-14 42-34 52z" fill="#4b7444" />
                        <path d="M46 86C40 56 44 26 58 6c8 26 2 56-12 80z" fill="#6f9b62" />
                        <path d="M46 86C36 66 22 60 6 64c10 14 24 22 40 22z" fill="#55804c" />
                        <path d="M46 86c10-16 26-22 42-18-8 14-24 20-42 18z" fill="#6a9560" />
                      </g>
                      <path d="M22 84h48l-6 46H28z" fill="#c4704b" />
                      <path d="M19 80h54v9H19z" fill="#d4825c" />
                      <path d="M28 130h36" stroke="rgb(0 0 0 / .18)" strokeWidth="2" />
                    </svg>
                  </div>
                  <div className="shelf-pile" aria-hidden="true" style={{ transform: `translate(${Math.max(layout.bookendX + 10, 826)}px, ${layout.shelfY - 46}px)` }}>
                    <span style={{ background: "rgb(59, 47, 110)", width: 146, marginLeft: 8 }} />
                    <span style={{ background: "rgb(229, 201, 122)", width: 136, marginLeft: 0 }} />
                    <span style={{ background: "rgb(164, 56, 72)", width: 156, marginLeft: 3 }} />
                  </div>
                  {layout.books.map((b) => {
                    const p = progressOf(b.doc);
                    return (
                      <div key={b.doc.slug} className="bk-x" style={{ transform: `translateX(${b.x}px)`, transitionDelay: `${b.i * 9}ms` }}>
                        <div className="bk-y" style={{ transform: `translateY(${layout.shelfY - b.spec.height}px)`, transitionDelay: `${b.i * 9}ms` }}>
                          <div className="bk-in" style={{ ["--i" as string]: b.i, transitionDelay: `${80 + b.i * 14}ms` }} data-out={open?.slug === b.doc.slug ? "" : undefined}>
                            <button
                              type="button"
                              data-book={b.doc.slug}
                              className="bk"
                              aria-label={`${b.doc.title} ${shortAuthor(b.doc)}`.trim()}
                              data-tip={b.doc.title}
                              data-tip-hint={`${b.doc.author ?? b.doc.sourceLabel ?? ""} · ${b.doc.kind === "link" ? "saved link" : `${b.doc.minutes} min`}${p?.finished ? " · read" : p && p.ratio > 0.02 ? ` · ${Math.round(p.ratio * 100)}% read` : ""}`}
                              onClick={(e) => setOpen({ slug: b.doc.slug, rect: (e.currentTarget.querySelector(".spine") as HTMLElement).getBoundingClientRect() })}
                              onKeyDown={(e) => {
                                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                                  e.preventDefault();
                                  const all = Array.from(document.querySelectorAll<HTMLButtonElement>("button.bk"));
                                  const i = all.indexOf(e.currentTarget);
                                  all[Math.max(0, Math.min(all.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)))]?.focus();
                                }
                              }}
                            >
                              <Spine spec={b.spec} doc={b.doc} inProgress={!!p && p.ratio > 0.02 && !p.finished} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {filtered.length ? <p className="lib-hint">Click a spine to take it down. Arrow keys walk the shelf.</p> : <p className="lib-hint">Nothing on this shelf yet.</p>}
            </>
          ) : (
            <div className="topic-grid">
              {topics.map((t, i) => {
                const items = docs.filter((d) => d.topic === t.id);
                const mins = items.reduce((n, d) => n + (d.minutes ?? 0), 0);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className="topic-card"
                    style={{ ["--c" as string]: t.color, ["--c-deep" as string]: t.deep, ["--i" as string]: i }}
                    onClick={() => {
                      setView("shelf");
                      setFilter(t.id);
                    }}
                  >
                    <div className="topic-card-art">
                      <TopicArt topic={t.id} seed={i} />
                    </div>
                    <div className="relative flex items-end justify-between gap-4 px-5 pb-1 pt-4">
                      <div className="min-w-0">
                        <h3 className="flex w-fit items-center font-serif text-[27px] leading-[1.05] tracking-[-0.015em] text-ink">
                          <TopicGlyph topic={t.id} size={30} className="mr-2 -mt-1" />
                          {t.label}
                        </h3>
                        <p className="mt-1.5 text-[13px] text-ink-3">
                          {items.length} piece{items.length === 1 ? "" : "s"} · {mins} min
                        </p>
                      </div>
                    </div>
                    <div className="mini-shelf" aria-hidden="true">
                      {items.slice(0, 12).map((d, j) => {
                        const s = spineFor(d);
                        return <span key={d.slug} className="mini-spine" style={{ width: Math.round(s.width / 2.6), height: Math.round(s.height / 4.2), background: s.bg, ["--j" as string]: j }} />;
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {docs.length <= 3 ? (
            <section className="starter" aria-label="Fill your library">
              <div className="starter-card is-classics">
                <div className="starter-fan" aria-hidden="true">
                  {["philosophy", "science", "writing", "ai", "programming"].map((t, i) => (
                    <div key={t} style={{ ["--i" as string]: i, overflow: "hidden" }}>
                      <TopicArt topic={t} seed={i + 3} />
                    </div>
                  ))}
                </div>
                <div className="min-w-0">
                  <p className="starter-title">Start with the three classics</p>
                  <p className="starter-body">Huxley on a piece of chalk, Schopenhauer on thinking for oneself, Thoreau on reading. Public domain, already on the shelf.</p>
                  <Link href="/read/on-a-piece-of-chalk" className="starter-btn">
                    Open one <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </div>
              </div>
              <button type="button" className="starter-card" onClick={() => setAdding(true)}>
                <span className="starter-icon">
                  <Link2 size={20} aria-hidden="true" />
                </span>
                <span className="starter-title">Save your own links</span>
                <span className="starter-body">Paste one or many. Understand.io reads each one in and sets it like an article.</span>
              </button>
              <Link href="/" className="starter-card">
                <span className="starter-icon is-agent">
                  <TopicGlyph topic="learning" size={34} />
                </span>
                <span className="starter-title">Open a PDF or paste text</span>
                <span className="starter-body">From the front page: a chapter, a paper, your own notes. Highlights and read-aloud work the same way.</span>
              </Link>
            </section>
          ) : null}
        </div>
              <BackupPanel />
      </main>

      {open && openDoc ? (
        <OpenBook
          doc={openDoc}
          progress={progressOf(openDoc)}
          origin={open.rect}
          readerNo={459}
          onClose={() => setOpen(null)}
          onTopic={(t) => updateDocumentMeta(openDoc.slug, { topic: t })}
          onFavourite={(v) => updateDocumentMeta(openDoc.slug, { favourite: v })}
          onRemove={() => {
            if (openDoc.kind === "sample") hideSample(openDoc.slug);
            removeDocument(openDoc.slug);
            setOpen(null);
            toast(`Removed “${openDoc.title}”.`, { ttl: 3000 });
          }}
        />
      ) : null}
      {adding ? (
        <AddPanel
          onClose={() => setAdding(false)}
          onSaved={(n) => {
            if (n) toast(`${n} article${n === 1 ? "" : "s"} shelved.`);
            void syncRemoteLibrary();
          }}
        />
      ) : null}
      <Toasts bottom={24} />
    </div>
  );
}
