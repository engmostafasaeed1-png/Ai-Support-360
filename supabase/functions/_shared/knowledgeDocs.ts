// Admin knowledge documents for the AI interviewer: type allowlist with content sniffing, safe file names, chunking.
// Pure functions (no Deno or browser APIs), unit-tested with vitest. Text extraction itself runs in the
// interview-knowledge edge function; this file decides what is accepted and how text becomes search chunks.

export const KNOWLEDGE_BUCKET = "interview-knowledge";
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 400_000;
export const MAX_CHUNKS_PER_DOCUMENT = 300;
export const CHUNK_CHARS = 1400;
export const MIN_CHUNK_CHARS = 80;
/** Fewer characters than this after extraction = "no text found" (for example a scanned PDF). */
export const MIN_DOCUMENT_TEXT = 200;
export const DOCUMENT_LANGUAGES = ["en", "ar", "de", "fr", "es", "other"] as const;

export type DocKind = "pdf" | "docx" | "txt" | "md";

export const KIND_MIME: Record<DocKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
};

export const ACCEPT_ATTRIBUTE = ".pdf,.docx,.txt,.md";

function extensionOf(name: string): string {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return m ? m[1] : "";
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

/** Valid UTF-8 without NUL bytes and with few control characters = a text file. */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (!bytes.length) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 65536));
  let control = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  if (control > sample.length * 0.01) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.length === bytes.length ? sample : trimUtf8(sample));
    return true;
  } catch {
    return false;
  }
}

/** Drops a multi-byte character cut at the end of a sample, so the strict decoder does not reject valid text. */
function trimUtf8(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const b = bytes[end - i];
    if ((b & 0xc0) === 0x80) continue;
    if ((b & 0xe0) === 0xc0 && i < 2) end -= i;
    else if ((b & 0xf0) === 0xe0 && i < 3) end -= i;
    else if ((b & 0xf8) === 0xf0 && i < 4) end -= i;
    break;
  }
  return bytes.subarray(0, end);
}

/**
 * The document type, only when the extension AND the content agree: PDF must start with %PDF-, DOCX must be a ZIP
 * (the Word part is checked during extraction), TXT/MD must be UTF-8 text. Anything else returns null.
 */
export function sniffDocument(bytes: Uint8Array, fileName: string): DocKind | null {
  const ext = extensionOf(fileName);
  if (ext === "pdf") return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? "pdf" : null;
  if (ext === "docx") return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ? "docx" : null;
  if (ext === "txt" || ext === "md") {
    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46]) || startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x4d, 0x5a])) return null;
    return looksLikeText(bytes) ? (ext as DocKind) : null;
  }
  return null;
}

/** Storage-safe name: letters, digits, dot, dash, underscore; no path; keeps the (allowed) extension. */
export function safeFileName(name: string): string {
  const base = String(name || "").split(/[\\/]/).pop() ?? "";
  const ext = extensionOf(base);
  const stem = base
    .slice(0, ext ? -(ext.length + 1) : undefined)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
  return `${stem || "document"}${ext ? `.${ext}` : ""}`;
}

/** Plain text cleaned for chunking: line endings, repeated blanks, control characters. */
export function cleanText(text: string): string {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/** Splits text into chunks of about CHUNK_CHARS at paragraph or sentence ends; very short pieces are merged. */
export function chunkText(text: string, maxChars = CHUNK_CHARS): string[] {
  const clean = cleanText(text);
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}|\n(?=#{1,6} )/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars) { pieces.push(p); continue; }
    let rest = p;
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars);
      const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"), window.lastIndexOf("; "));
      const at = cut > maxChars * 0.5 ? cut + 1 : (window.lastIndexOf(" ") > maxChars * 0.5 ? window.lastIndexOf(" ") : maxChars);
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }
  const chunks: string[] = [];
  let cur = "";
  for (const piece of pieces) {
    if (!cur) { cur = piece; continue; }
    if (cur.length + 2 + piece.length <= maxChars) cur = `${cur}\n\n${piece}`;
    else { chunks.push(cur); cur = piece; }
  }
  if (cur) chunks.push(cur);
  return chunks.filter((c) => c.length >= MIN_CHUNK_CHARS || chunks.length === 1).slice(0, MAX_CHUNKS_PER_DOCUMENT);
}

/** Readable reasons shown on the status chip (English; the admin page translates by code). */
export const STATUS_REASONS = {
  no_text: "No text found. This looks like a scanned PDF or an image-only file. Upload a text-based PDF, DOCX, TXT or MD.",
  bad_docx: "This DOCX file has no Word document inside, or it is damaged.",
  pdf_unreadable: "The PDF could not be read. It may be password-protected or damaged.",
  too_large: "The file is larger than 10 MB.",
  wrong_type: "Only PDF, DOCX, TXT and MD files are accepted, and the content must match the file type.",
  failed: "Text extraction failed. Try Re-extract, or upload the file again.",
} as const;
export type StatusReasonCode = keyof typeof STATUS_REASONS;

// ---------------------------------------------------------------------------------------------------------------
// Admin settings (platform_settings key "interview_knowledge"), with safe bounds. OFF until the owner switches it on.

export const KNOWLEDGE_SETTINGS_KEY = "interview_knowledge";

export interface KnowledgeSettings {
  enabled: boolean;
  min_per_module: number;
  max_per_module: number;
  total_questions: number;
  max_modules: number;
  max_docs_per_module: number;
  max_total_mb: number;
  max_ai_calls: number;
  max_excerpts: number;
  excerpt_chars: number;
}

export const DEFAULT_KNOWLEDGE_SETTINGS: KnowledgeSettings = {
  enabled: false,
  min_per_module: 1,
  max_per_module: 3,
  total_questions: 8,
  max_modules: 8,
  max_docs_per_module: 20,
  max_total_mb: 200,
  max_ai_calls: 2,
  max_excerpts: 6,
  excerpt_chars: 600,
};

const BOUNDS: Record<Exclude<keyof KnowledgeSettings, "enabled">, [number, number]> = {
  min_per_module: [0, 3],
  max_per_module: [1, 6],
  total_questions: [3, 16],
  max_modules: [1, 12],
  max_docs_per_module: [1, 200],
  max_total_mb: [10, 2000],
  max_ai_calls: [1, 4],
  max_excerpts: [0, 12],
  excerpt_chars: [200, 1200],
};

export function normalizeKnowledgeSettings(raw: unknown): KnowledgeSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_KNOWLEDGE_SETTINGS, enabled: r.enabled === true };
  for (const [k, [lo, hi]] of Object.entries(BOUNDS) as Array<[keyof typeof BOUNDS, [number, number]]>) {
    const n = Math.round(Number(r[k]));
    out[k] = Number.isFinite(n) && r[k] !== null && r[k] !== "" ? Math.min(hi, Math.max(lo, n)) : DEFAULT_KNOWLEDGE_SETTINGS[k];
  }
  if (out.max_per_module < out.min_per_module) out.max_per_module = Math.max(1, out.min_per_module);
  return out;
}
