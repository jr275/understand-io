import { describe, expect, it } from "vitest";
import { classifyUpload } from "@/lib/content/uploadKind";

const bytes = (s: string | number[]) => (typeof s === "string" ? new TextEncoder().encode(s) : new Uint8Array(s));

describe("classifyUpload", () => {
  it("reads PDFs by extension or declared type", () => {
    expect(classifyUpload("paper.PDF", "", bytes("%PDF-1.7"))).toBe("pdf");
    expect(classifyUpload("download", "application/pdf", bytes("%PDF"))).toBe("pdf");
  });
  it("reads text and markdown", () => {
    expect(classifyUpload("notes.txt", "text/plain", bytes("hello"))).toBe("text");
    expect(classifyUpload("essay.md", "", bytes("# Title"))).toBe("text");
    expect(classifyUpload("essay.markdown", "text/markdown", bytes("# Title"))).toBe("text");
    expect(classifyUpload("pasted", "text/plain", bytes("hello"))).toBe("text");
  });
  it("refuses images, archives and anything else, whatever their bytes", () => {
    expect(classifyUpload("x.gif", "image/gif", bytes("GIF89a"))).toBe("unsupported"); // used to be imported as a document of one line
    expect(classifyUpload("x.png", "image/png", bytes([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe("unsupported");
    expect(classifyUpload("data.zip", "application/zip", bytes("PK"))).toBe("unsupported");
    expect(classifyUpload("page.html", "text/html", bytes("<p>x</p>"))).toBe("unsupported");
  });
  it("refuses binary data that is named or labelled as text", () => {
    expect(classifyUpload("blob.txt", "text/plain", bytes([0x01, 0x02, 0x00, 0x03]))).toBe("binary");
  });
});
