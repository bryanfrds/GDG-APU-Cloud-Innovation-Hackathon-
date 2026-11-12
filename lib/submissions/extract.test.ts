import { describe, expect, it } from "vitest";
import { extractAssignmentText, MAX_FILE_BYTES, MAX_TEXT_CHARS } from "./extract";

const enc = (s: string) => new TextEncoder().encode(s);

// A one-page PDF with the text "Hello viva", written by hand so the test needs no fixture file.
function tinyPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(out);
}

describe("extractAssignmentText", () => {
  it("reads code files as text and tidies line endings", async () => {
    expect(await extractAssignmentText("Main.java", enc("class A {}\r\n"))).toEqual({ text: "class A {}", kind: "code" });
  });

  it("reads text out of a PDF", async () => {
    const result = await extractAssignmentText("report.PDF", tinyPdf("Hello viva"));
    expect(result).toMatchObject({ kind: "pdf" });
    expect("text" in result && result.text).toContain("Hello viva");
  });

  it("refuses other file types, empty files, big files and non-UTF-8 text", async () => {
    expect(await extractAssignmentText("photo.png", enc("x"))).toHaveProperty("error");
    expect(await extractAssignmentText("noext", enc("x"))).toHaveProperty("error");
    expect(await extractAssignmentText("a.py", new Uint8Array())).toEqual({ error: "That file is empty." });
    expect(await extractAssignmentText("a.py", new Uint8Array(MAX_FILE_BYTES + 1).fill(97))).toHaveProperty("error");
    expect(await extractAssignmentText("a.txt", new Uint8Array([0xff, 0xfe, 0x00]))).toHaveProperty("error");
  });

  it("refuses an assignment longer than Gemini is given, and a PDF it can't read", async () => {
    expect(await extractAssignmentText("a.txt", enc("x".repeat(MAX_TEXT_CHARS + 1)))).toHaveProperty("error");
    expect(await extractAssignmentText("a.pdf", enc("not a pdf"))).toHaveProperty("error");
    expect(await extractAssignmentText("a.txt", enc("   \n  "))).toHaveProperty("error");
  });
});
