import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ReadError } from "@/lib/content/errors";
import { documentFromPdf } from "@/lib/content/pdf";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));

/** What the reader is told is part of the contract: a file that cannot be read is explained, never a blank document or a server error. */
async function refusal(bytes: Uint8Array) {
  const err = await documentFromPdf(bytes, "x.pdf").then(
    () => null,
    (e: unknown) => e,
  );
  return err;
}

describe("PDFs that cannot be turned into text", () => {
  it("a scan (a page with a picture and no text layer) is refused with the reason, and the app says it does not read images", async () => {
    const err = await refusal(fixture("scanned-image-only.pdf"));
    expect(err).toBeInstanceOf(ReadError);
    const message = (err as ReadError).message;
    expect(message).toMatch(/no selectable text/i);
    expect(message).toMatch(/scan|image/i);
    expect(message).toMatch(/does not (read|recogni[sz]e) (text in )?images|no OCR|cannot (read|recogni[sz]e) (text in )?images/i);
    expect(message).not.toMatch(/\bOCR (is|can be) (available|supported|enabled)/i); // never promise what does not exist
  });

  it("text that is not a PDF at all, an empty file and a cut-off PDF are refused as unreadable, not crashed on", async () => {
    for (const bytes of [new TextEncoder().encode("%PDF-1.4\nthis is not a pdf at all"), new Uint8Array(0), fixture("paragraph-gaps.pdf").slice(0, 400)]) {
      const err = await refusal(bytes);
      expect(err).toBeInstanceOf(ReadError);
      expect((err as ReadError).message.length).toBeGreaterThan(10);
      expect((err as ReadError).message).not.toMatch(/at \w+ \(|node_modules|\/Users\//); // no stack or path
    }
  });

  it("a PDF with a text layer is still read (the control for the refusals above)", async () => {
    const doc = await documentFromPdf(fixture("paragraph-gaps.pdf"), "paragraph-gaps.pdf");
    expect(doc.blocks.length).toBeGreaterThan(2);
  });
});
