// Turns an uploaded assignment file into plain text Gemini can read.
// Code and text files are read as UTF-8; PDFs need selectable text (scans have none).
import { extractText, getDocumentProxy } from "unpdf";

export const MAX_FILE_BYTES = 2 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB
export const MAX_TEXT_CHARS = 30_000;
export const MAX_PDF_PAGES = 50;

const TEXT_EXTENSIONS = new Set([".py", ".java", ".cpp", ".c", ".h", ".js", ".ts", ".txt", ".md"]);
export const ACCEPTED_EXTENSIONS = [".pdf", ...TEXT_EXTENSIONS];

export type Extracted = { text: string; kind: "pdf" | "code" } | { error: string };

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

export async function extractAssignmentText(fileName: string, bytes: Uint8Array): Promise<Extracted> {
  const ext = extensionOf(fileName);
  if (ext !== ".pdf" && !TEXT_EXTENSIONS.has(ext)) {
    return { error: `Upload a PDF or a code file (${ACCEPTED_EXTENSIONS.join(", ")}).` };
  }
  if (bytes.byteLength === 0) return { error: "That file is empty." };
  if (bytes.byteLength > MAX_FILE_BYTES) return { error: "That file is over 2 MB." };

  let text: string;
  if (ext === ".pdf") {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      if (pdf.numPages > MAX_PDF_PAGES) return { error: `That PDF has more than ${MAX_PDF_PAGES} pages.` };
      const result = await extractText(pdf, { mergePages: true });
      text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
    } catch {
      return { error: "Couldn't read that PDF. Is it password-protected or damaged?" };
    }
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { error: "That file isn't readable text (UTF-8)." };
    }
  }

  text = text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
  if (!text) {
    return { error: ext === ".pdf" ? "That PDF has no selectable text (a scan?)." : "That file has no text." };
  }
  if (text.length > MAX_TEXT_CHARS) {
    return { error: `That assignment is too long (over ${MAX_TEXT_CHARS.toLocaleString("en")} characters).` };
  }
  return { text, kind: ext === ".pdf" ? "pdf" : "code" };
}
