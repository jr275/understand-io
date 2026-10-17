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

import { classifyFetched } from "@/lib/content/uploadKind";

describe("classifyFetched (what a link points to)", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  it("reads a PDF by its bytes even when the server labels it octet-stream or html", () => {
    expect(classifyFetched("application/octet-stream", "/download", bytes("%PDF-1.7\n..."))).toBe("pdf");
    expect(classifyFetched("text/html", "/x", bytes("%PDF-1.4"))).toBe("pdf");
    expect(classifyFetched("application/pdf", "/paper", bytes("<!doctype"))).toBe("pdf");
    expect(classifyFetched("application/octet-stream", "/paper.pdf", bytes("whatever"))).toBe("pdf");
    expect(classifyFetched("", "/paper.PDF", bytes("whatever"))).toBe("pdf");
  });
  it("reads web pages", () => {
    expect(classifyFetched("text/html; charset=utf-8", "/", bytes("<html>"))).toBe("html");
    expect(classifyFetched("application/xhtml+xml", "/", bytes("<html>"))).toBe("html");
    expect(classifyFetched("", "/", bytes("  <!DOCTYPE html><html>"))).toBe("html");
    expect(classifyFetched("application/octet-stream", "/", bytes("<html lang=en>"))).toBe("html");
  });
  it("reads plain text and markdown, not a page served as text/plain with an html name", () => {
    expect(classifyFetched("text/plain", "/notes.txt", bytes("hello"))).toBe("text");
    expect(classifyFetched("text/markdown", "/README.md", bytes("# hi"))).toBe("text");
    expect(classifyFetched("text/plain", "/raw/file", bytes("hello"))).toBe("text");
    expect(classifyFetched("text/plain", "/index.html", bytes("<p>hi</p>"))).toBe("html");
    expect(classifyFetched("", "/x", bytes("just some text"))).toBe("text");
  });
  it("refuses images, archives, binaries and empty bodies", () => {
    expect(classifyFetched("image/png", "/a.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("unsupported");
    expect(classifyFetched("application/zip", "/a.zip", bytes("PK"))).toBe("unsupported");
    expect(classifyFetched("application/octet-stream", "/blob", new Uint8Array([1, 0, 2, 3]))).toBe("unsupported");
    expect(classifyFetched("", "/", new Uint8Array())).toBe("unsupported");
    expect(classifyFetched("application/json", "/data", bytes("{}"))).toBe("unsupported");
  });
});
