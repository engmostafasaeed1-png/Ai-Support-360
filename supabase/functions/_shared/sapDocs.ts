// SAP's open documentation (github.com/SAP-docs, licence CC BY 4.0): which files to take, how a markdown file becomes search chunks, and the links.
// Pure functions (no Deno or browser APIs), so the same file is unit-tested with vitest.

export const MAX_CHUNK_CHARS = 1800;
export const MIN_CHUNK_CHARS = 120;
export const MIN_DOC_CHARS = 200;
export const MAX_CHUNKS_PER_FILE = 40;
export const MAX_FILE_BYTES = 300_000;
export const MAX_FILES = 8000;

export interface PlannedFile {
  path: string;
  bytes: number;
}

export interface DocChunk {
  chunkNo: number;
  heading: string | null;
  body: string;
}

export interface ParsedDoc {
  title: string;
  chunks: DocChunk[];
  textBytes: number;
}

const REPO = /^SAP-docs\/[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/;

/** Only repositories of the SAP-docs organisation are ever read. */
export function isSapDocsRepo(repo: unknown): repo is string {
  return typeof repo === "string" && REPO.test(repo);
}

export function isBranchName(branch: unknown): branch is string {
  return typeof branch === "string" && BRANCH.test(branch) && !branch.includes("..");
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function treeApiUrl(repo: string, branch: string): string {
  return `https://api.github.com/repos/${repo}/git/trees/${encodePath(branch)}?recursive=1`;
}

export function rawFileUrl(repo: string, branch: string, path: string): string {
  return `https://raw.githubusercontent.com/${repo}/${encodePath(branch)}/${encodePath(path)}`;
}

/** The page of a file on GitHub: the reader sees the original text, its licence and its history there. */
export function docUrl(repo: string, branch: string, path: string): string {
  return `https://github.com/${repo}/blob/${encodePath(branch)}/${encodePath(path)}`;
}

const SKIP_NAME = /^(readme|contributing|licen[cs]e|code[_-]of[_-]conduct|security|changelog|notice)\.md$/i;
const SKIP_ANYWHERE = /what-?s-?new|change-?log|previous-versions|release-notes?/i;

/** The markdown files of a repository tree (the answer of GitHub's git/trees API) that are worth reading: documentation pages, not release notes. */
export function selectDocFiles(tree: unknown): PlannedFile[] {
  if (!Array.isArray(tree)) return [];
  const out: PlannedFile[] = [];
  for (const raw of tree as Array<Record<string, unknown> | null>) {
    if (!raw || raw.type !== "blob" || typeof raw.path !== "string") continue;
    const path = raw.path;
    const size = typeof raw.size === "number" && Number.isFinite(raw.size) ? Math.floor(raw.size) : 0;
    if (!/\.md$/i.test(path) || path.length > 400) continue;
    const parts = path.split("/");
    if (parts.length < 2) continue; // files in the root of the repository: readme, licence ...
    if (parts.some((p) => p.startsWith(".") || p === "node_modules" || p === "LICENSES")) continue;
    if (SKIP_NAME.test(parts[parts.length - 1])) continue;
    if (SKIP_ANYWHERE.test(path)) continue;
    if (size <= 0 || size > MAX_FILE_BYTES) continue;
    out.push({ path, bytes: size });
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out.slice(0, MAX_FILES);
}

/** "docs/set-up/setting-up-authorization-cb9f0ac.md" becomes "Setting up authorization". */
export function titleFromPath(path: string): string {
  const name = (path.split("/").pop() ?? path).replace(/\.md$/i, "").replace(/-[0-9a-f]{7}$/i, "");
  const words = name.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Documentation";
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole: string, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return NAMED[e.toLowerCase()] ?? whole;
  });
}

/** One line of markdown as plain text: tags, images and link addresses removed, escapes and emphasis resolved. */
function cleanLine(line: string): string {
  let s = line;
  s = s.replace(/<br\s*\/?>/gi, " ");
  s = s.replace(/<\/(?:td|th)>/gi, " | ");
  s = s.replace(/<\/?[A-Za-z][^>]*>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\{:[^}]*\}|\{#[^}]*\}/g, "");
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!<>|~])/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=$|[\s).,;:!?])/g, "$1$2");
  s = s.replace(/^\s*>+\s?/, "");
  return s.replace(/[ \t]+/g, " ").trim();
}

/** Cuts a long paragraph into pieces of at most MAX_CHUNK_CHARS, at a sentence end or a space when it can. */
function splitLong(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > MAX_CHUNK_CHARS) {
    const window = rest.slice(0, MAX_CHUNK_CHARS);
    let cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "), window.lastIndexOf("\n"));
    if (cut < MAX_CHUNK_CHARS * 0.5) cut = window.lastIndexOf(" ");
    if (cut < MAX_CHUNK_CHARS * 0.3) cut = MAX_CHUNK_CHARS - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/** SAP's call-out boxes ("> ### Tip:", "> ### Note:") are written as headings: they are text of the section they sit in, not a section of their own. */
const CALLOUT_LABEL = /^(?:note|tip|caution|warning|important|remember|recommendation|restriction|example|hint|attention|sample code)s?:$/i;

interface Section {
  level: number;
  heading: string | null;
  lines: string[];
}

/**
 * A markdown file of SAP's documentation becomes a title and a few text chunks of at most MAX_CHUNK_CHARS each.
 * A new chunk starts at a heading of level 1 to 3 (when the chunk before it is long enough); every chunk keeps the heading it sits under.
 * Pages that hold only a list of links (fewer than MIN_DOC_CHARS of text) give no chunks.
 */
export function parseDoc(path: string, markdown: string): ParsedDoc {
  const bare = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown; // a byte order mark at the start of the file
  const text = bare
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ") // control characters (a database text can not hold them)
    .replace(/\r\n?/g, "\n")
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // images, also when the caption runs over two lines

  const sections: Section[] = [{ level: 0, heading: null, lines: [] }];
  let title = "";
  let fence: string | null = null;
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    const mark = /^(`{3,}|~{3,})/.exec(trimmed);
    if (mark) {
      if (fence === null) fence = mark[1][0];
      else if (trimmed.startsWith(fence.repeat(3))) fence = null;
      continue; // the fence lines themselves are dropped
    }
    const current = sections[sections.length - 1];
    if (fence !== null) {
      current.lines.push(raw.trimEnd().slice(0, 400)); // code stays as it is
      continue;
    }
    const line = cleanLine(raw);
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const heading = h[2].trim().slice(0, 200);
      if (CALLOUT_LABEL.test(heading)) {
        current.lines.push(heading); // a call-out label stays in the text
        continue;
      }
      if (h[1].length === 1 && !title) title = heading;
      sections.push({ level: h[1].length, heading, lines: [] });
      continue;
    }
    if (/^[|\s]*$/.test(line)) {
      current.lines.push("");
      continue;
    }
    if (/^\|?[\s:|-]+\|?$/.test(line) && line.includes("-")) continue; // the line under a table header
    current.lines.push(line);
  }

  const docTitle = (title || titleFromPath(path)).slice(0, 200);
  const chunks: DocChunk[] = [];
  let heading: string | null = null;
  let lastHeading: string | null = null;
  let parts: string[] = [];
  let length = 0;
  const flush = () => {
    const body = parts.join("\n\n").trim();
    if (body) chunks.push({ chunkNo: chunks.length, heading, body });
    parts = [];
    length = 0;
  };
  for (const section of sections) {
    const own = section.heading && section.heading !== docTitle ? section.heading : null;
    if (section.level >= 1 && section.level <= 3 && length >= MIN_CHUNK_CHARS) flush();
    if (own) lastHeading = own;
    if (parts.length === 0) heading = own ?? lastHeading;
    else if (own) {
      parts.push(own);
      length += own.length + 2;
    }
    const paragraphs = section.lines.join("\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    for (const paragraph of paragraphs) {
      for (const piece of splitLong(paragraph)) {
        if (length + piece.length + 2 > MAX_CHUNK_CHARS && length >= MIN_CHUNK_CHARS) {
          flush();
          heading = own ?? lastHeading;
        }
        parts.push(piece);
        length += piece.length + 2;
      }
    }
  }
  flush();

  const total = chunks.reduce((n, c) => n + c.body.length, 0);
  const kept = total < MIN_DOC_CHARS ? [] : chunks.slice(0, MAX_CHUNKS_PER_FILE);
  const enc = new TextEncoder();
  const textBytes = kept.reduce((n, c) => n + enc.encode(`${docTitle}${c.heading ?? ""}${c.body}`).length, 0);
  return { title: docTitle, chunks: kept, textBytes };
}
