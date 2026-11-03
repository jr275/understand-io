import { ImageResponse } from "next/og";

/** The social card for every page that has no card of its own: the product's name and its one idea, in the colours of the paper theme. Drawn at build time, no external font or image. */
export const alt = "Understand.io: highlight any line and ask it anything";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 96px", background: "#f6f3ec", color: "#151412", fontFamily: "Georgia, serif" }}>
        <div style={{ display: "flex", fontSize: 30, letterSpacing: 2, textTransform: "uppercase", color: "#7a756c", fontFamily: "sans-serif" }}>Understand.io</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 28, fontSize: 92, lineHeight: 1.04, letterSpacing: -2 }}>
          <div style={{ display: "flex" }}>
            Highlight <span style={{ marginLeft: 22, padding: "0 14px", background: "#f1c9bd" }}>any line</span>.
          </div>
          <div style={{ display: "flex" }}>Ask it anything.</div>
        </div>
        <div style={{ display: "flex", marginTop: 40, fontSize: 32, color: "#4a463f", fontFamily: "sans-serif" }}>The answer is written in the margin, beside the words, citing the paragraphs it used.</div>
      </div>
    ),
    size,
  );
}
