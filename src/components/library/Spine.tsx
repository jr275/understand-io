import type { GlossDocument } from "@/lib/content/types";
import { TopicGlyph } from "./TopicGlyph";
import { shortAuthor, type SpineSpec } from "./shelf";

export function Spine({ spec, doc, inProgress = false, className = "" }: { spec: SpineSpec; doc: Omit<GlossDocument, "blocks">; inProgress?: boolean; className?: string }) {
  const by = shortAuthor(doc);
  return (
    <div
      className={`spine ${spec.wide ? "is-wide" : "is-narrow"} ${className}`}
      data-style={spec.style}
      data-light={spec.light ? "true" : undefined}
      style={{ width: spec.width, height: spec.height, background: spec.bg, color: spec.fg, ["--fg" as string]: spec.fg }}
    >
      {inProgress ? <span className="spine-ribbon" aria-hidden="true" /> : null}
      {spec.style === "bands" ? (
        <>
          <span className="spine-bands top" />
          <span className="spine-bands bottom" />
        </>
      ) : null}
      {spec.style === "foil" ? <span className="spine-orn">◆</span> : null}
      {spec.style === "sans" ? <TopicGlyph topic={doc.topic} size={15} className="spine-emoji" /> : null}
      <span className={`spine-title-wrap ${spec.style === "label" ? "is-label" : ""}`}>
        <span className="spine-title" style={{ fontSize: spec.fontSize }}>
          {doc.title}
          {!spec.wide && by ? <span className="spine-by">{by}</span> : null}
        </span>
      </span>
      {spec.wide && by ? (
        <span className="spine-author" style={{ fontSize: 11 }}>
          {by}
        </span>
      ) : null}
    </div>
  );
}
