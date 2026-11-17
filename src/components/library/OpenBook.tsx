"use client";

import { useEffect, useRef, useState } from "react";
import { useModalFocus } from "@/lib/client/useModalFocus";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, Star, Trash2 } from "lucide-react";
import type { GlossDocument, ReadingProgress } from "@/lib/content/types";
import { TOPICS, topicInfo } from "@/lib/content/types";
import { Spine } from "./Spine";
import { TopicArt, TopicGlyph } from "./TopicGlyph";
import { spineFor } from "./shelf";
import { useT } from "@/i18n/client";
import { topicName } from "@/i18n/topics";

interface Props {
  doc: Omit<GlossDocument, "blocks">;
  progress?: ReadingProgress;
  origin: DOMRect | null;
  onClose: () => void;
  onTopic: (t: string) => void;
  onFavourite: (v: boolean) => void;
  onRemove: () => void;
  readerNo: number;
}

/** The "take it down" dialog: a 3D book that turns to face the reader and opens its cover. */
export function OpenBook({ doc, progress, origin, onClose, onTopic, onFavourite, onRemove, readerNo }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<"in" | "open" | "leaving">("in");
  const spec = spineFor(doc);
  const topic = topicInfo(doc.topic);
  const t = useT();
  const W = 340;
  const H = 483;
  const D = 117;

  const stageRef = useRef<HTMLDivElement>(null);
  useModalFocus(stageRef);

  const close = () => {
    setPhase("leaving");
    window.setTimeout(onClose, 420);
  };

  useEffect(() => {
    const r1 = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("open")));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(r1);
      document.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start on the shelf (scaled to the spine, turned 90°), then come to the centre.
  const start = origin
    ? `translate3d(${origin.left + origin.width / 2 - window.innerWidth / 2}px, ${origin.top + origin.height / 2 - window.innerHeight / 2}px, 0) scale3d(${spec.height / H}, ${spec.height / H}, ${spec.height / H}) translateZ(${-W / 2}px) rotateY(90deg)`
    : `translate3d(-420px, 120px, 0) scale3d(.45,.45,.45) translateZ(-170px) rotateY(90deg)`;
  const centre = `translate3d(60px, 0, 0) rotateY(0deg)`;
  const pct = Math.round((progress?.ratio ?? 0) * 100);
  const status = progress?.finished ? t("book.finished") : pct > 2 ? t("library.percentRead", { n: pct }) : t("book.notStarted");

  return (
    <div ref={stageRef} className="ob-stage" data-phase={phase === "in" ? "in" : phase} role="dialog" aria-modal="true" aria-label={doc.title}>
      <div className="ob-backdrop" onClick={close} />
      <div className="ob-world">
        <div className="ob-shift">
          <div className="ob-book" style={{ width: W, height: H, marginLeft: -W / 2, marginTop: -H / 2, transform: phase === "in" ? start : centre, ["--c" as string]: topic.deep }}>
            <div className="ob-face ob-back" style={{ transform: `rotateY(180deg) translateZ(${D / 2}px)`, background: spec.bg }} />
            <div className="ob-face ob-spine" style={{ width: D, left: (W - D) / 2, transform: `rotateY(-90deg) translateZ(${W / 2}px)` }}>
              <div style={{ transform: `scale(${H / spec.height})`, transformOrigin: "0 0", width: spec.width, height: spec.height }}>
                <Spine spec={{ ...spec, width: D / (H / spec.height) }} doc={doc} />
              </div>
            </div>
            <div className="ob-face ob-edge" style={{ width: D - 6, height: H - 8, top: 4, left: (W - D) / 2 + 3, transform: `rotateY(90deg) translateZ(${W / 2 - 4}px)` }} />
            <div className="ob-face ob-edge is-top" style={{ width: W - 6, height: D - 6, left: 3, top: (H - D) / 2, transform: `rotateX(90deg) translateZ(${H / 2 - 4}px)` }} />
            <div className="ob-face ob-edge is-top" style={{ width: W - 6, height: D - 6, left: 3, top: (H - D) / 2, transform: `rotateX(-90deg) translateZ(${H / 2 - 4}px)` }} />
            <div className="ob-face ob-board" style={{ transform: `translateZ(${D / 2 - 6}px)`, background: spec.bg }} />
            <div className="ob-face ob-page" style={{ width: W - 9, height: H - 12, top: 6, left: 1, transform: `translateZ(${D / 2 - 2}px)` }}>
              <div className="ob-page-in scroll-thin">
                <div className="ob-kicker">
                  <label className="ob-chip" data-tip={t("book.moveTopic")} style={{ ["--c" as string]: topic.color }}>
                    <TopicGlyph topic={doc.topic} size={15} />
                    <span>{topicName(t, doc.topic)}</span>
                    <ChevronDown size={13} strokeWidth={2.2} aria-hidden="true" className="ob-chip-caret" />
                    <select aria-label={t("book.topic")} value={doc.topic} onChange={(e) => onTopic(e.target.value)}>
                      {TOPICS.map((x) => (
                        <option key={x.id} value={x.id}>
                          {topicName(t, x.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="ob-tools">
                    <button type="button" className="ob-icon" aria-pressed={!!doc.favourite} aria-label={doc.favourite ? t("book.removeFavourite") : t("book.addFavourite")} data-tip={doc.favourite ? t("book.removeFavourite") : t("book.addFavourite")} onClick={() => onFavourite(!doc.favourite)}>
                      <Star size={15} aria-hidden="true" fill={doc.favourite ? "currentColor" : "none"} />
                    </button>
                    <button type="button" className="ob-icon" aria-label={doc.kind === "sample" ? t("book.removeSample") : t("book.removeFromLibrary")} data-tip={doc.kind === "sample" ? t("book.removeSample") : t("book.removeFromLibrary")} onClick={onRemove}>
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </span>
                </div>
                <h2 className="ob-title">{doc.title}</h2>
                <p className="ob-author">
                  {doc.author || doc.sourceLabel || t("book.unknownAuthor")}
                  <span className="ob-meta">
                    {doc.year ? `${doc.year} · ` : ""}
                    {doc.kind === "link" ? t("library.savedLink") : t("library.minutes", { n: doc.minutes })}
                  </span>
                </p>
                {doc.dek ? <p className="ob-dek">{doc.dek}</p> : null}
                <p className="ob-tags">
                  <span className="is-word">{doc.kind === "sample" ? t("book.kindSample") : doc.kind === "pdf" ? t("book.kindPdf") : doc.kind === "text" ? t("book.kindText") : doc.kind === "link" ? t("book.kindLink") : doc.sourceLabel || t("book.kindOther")}</span>
                </p>
                <div className="ob-progress">
                  <span className="ob-bar" aria-hidden="true">
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span>{status}</span>
                </div>
                <div className="ob-actions">
                  <button type="button" className="ob-read" onClick={() => router.push(`/read/${doc.slug}`)}>
                    {doc.kind === "link" ? t("book.openLink") : pct > 2 && !progress?.finished ? t("book.continue") : progress?.finished ? t("book.readAgain") : t("book.start")}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                  <div className="ob-sub">
                    <span />
                    <button type="button" className="ob-link" onClick={close}>
                      {t("book.putBack")} <kbd>Esc</kbd>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="ob-cover" style={{ transform: `translateZ(${D / 2}px) rotateY(${phase === "open" || phase === "leaving" ? -150 : 0}deg)` }}>
              <div className="ob-face ob-cover-front">
                <div className="cover" style={{ background: spec.bg, color: spec.fg }}>
                  <div className="cover-plate">
                    <div className="plate-art">
                      <TopicArt topic={doc.topic} seed={doc.slug.length} />
                    </div>
                  </div>
                  <div className="cover-type">
                    <p className="cover-kicker">
                      <TopicGlyph topic={doc.topic} size={14} className="cover-glyph" />
                      <span>{topicName(t, doc.topic)}</span>
                      {doc.year ? <span className="tabular-nums">{doc.year}</span> : null}
                    </p>
                    <p className="cover-title">{doc.title}</p>
                    <p className="cover-author">{doc.author || doc.sourceLabel}</p>
                  </div>
                  <span className="cover-hinge" aria-hidden="true" />
                </div>
              </div>
              <div className="ob-face ob-cover-inside" style={{ ["--c" as string]: topic.deep, ["--c2" as string]: topic.color }}>
                <div className="ex-libris">
                  <div className="ex-art">
                    <TopicGlyph topic={doc.topic} size={60} />
                  </div>
                  <p className="ex-head">{t("book.fromLibraryOf")}</p>
                  <p className="ex-name">{t("book.aReader")}</p>
                  <span className="ex-rule" aria-hidden="true" />
                  <p className="ex-meta">{t("book.number", { n: readerNo })}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
