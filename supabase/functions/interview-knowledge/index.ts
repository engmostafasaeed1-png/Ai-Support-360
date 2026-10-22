// Admin > AI Interviewer Training: knowledge documents and the "Preview for a consultant" tool.
// Admins only (admin / super_admin, checked in code on every call). Uploads are accepted only here: type allowlist by
// extension AND content, 10 MB, safe file names, rights confirmation, per-module / total caps. Files go to the private
// "interview-knowledge" bucket with the service role; text is extracted and chunked here (bounded, claimed per document).
// Document text is untrusted: it never reaches a candidate, and only short sanitised excerpts reach the AI.
//
// Actions: multipart POST (form field "file" + "meta") = upload; JSON {action}: update | delete | reextract | preview.

import { z } from "https://esm.sh/zod@3.23.8";
import { adminClient, authenticateUser, corsHeaders, getUserRoles, hasAnyRole, ADMIN_ROLES, withinRateLimit } from "../_shared/security.ts";
import {
  ACCEPT_ATTRIBUTE, chunkText, cleanText, DOCUMENT_LANGUAGES, KIND_MIME, KNOWLEDGE_BUCKET, MAX_DOCUMENT_BYTES, MIN_DOCUMENT_TEXT,
  safeFileName, sniffDocument, STATUS_REASONS, type DocKind,
} from "../_shared/knowledgeDocs.ts";
import { scanPersonalData } from "../_shared/untrustedText.ts";
import { buildPlanAndQuestions, knowledgeTablesReady, loadKnowledgeSettings } from "../_shared/interviewKnowledge.ts";
import { docUrl, isBranchName, isSapDocsRepo } from "../_shared/sapDocs.ts";

const Meta = z.object({
  title: z.string().trim().min(1).max(200),
  sap_module: z.string().trim().min(1).max(120),
  sap_version: z.string().trim().max(60).nullable().optional(),
  language: z.enum(DOCUMENT_LANGUAGES),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  enabled: z.boolean().default(true),
  notes: z.string().max(2000).nullable().optional(),
  rights_confirmed: z.literal(true),
});
const Update = z.object({
  action: z.literal("update"),
  document_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  sap_module: z.string().trim().min(1).max(120).optional(),
  sap_version: z.string().trim().max(60).nullable().optional(),
  language: z.enum(DOCUMENT_LANGUAGES).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  enabled: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
const Delete = z.object({ action: z.literal("delete"), document_id: z.string().uuid(), reason: z.string().trim().min(3).max(300) });
const Reextract = z.object({ action: z.literal("reextract"), document_id: z.string().uuid() });
const Preview = z.object({ action: z.literal("preview"), consultant_id: z.string().uuid(), lang: z.enum(["en", "ar"]).default("en") });
const Body = z.discriminatedUnion("action", [Update, Delete, Reextract, Preview]);

const tags = (list: string[] | undefined) => [...new Set((list ?? []).map((t) => t.replace(/[<>[\]{}]/g, "").trim()).filter(Boolean))].slice(0, 20);
const cleanVersion = (v: string | null | undefined) => (v && v.replace(/[<>[\]{}]/g, "").trim()) || null;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function docxText(bytes: Uint8Array): Promise<string | null> {
  const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return null;
  return xml
    .replace(/<\/w:p>/g, "\n\n")
    .replace(/<w:tab\/>/g, " ")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("npm:unpdf@0.12.1");
  const pdf = await getDocumentProxy(bytes);
  if (pdf.numPages > 400) throw new Error("too_many_pages");
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [String(text)]).join("\n\n");
}

async function extractText(kind: DocKind, bytes: Uint8Array): Promise<{ text: string | null; reason: keyof typeof STATUS_REASONS | null }> {
  try {
    if (kind === "pdf") return { text: await pdfText(bytes), reason: null };
    if (kind === "docx") {
      const t = await docxText(bytes);
      return t === null ? { text: null, reason: "bad_docx" } : { text: t, reason: null };
    }
    return { text: new TextDecoder("utf-8").decode(bytes), reason: null };
  } catch (e) {
    console.error("extract:", kind, (e as Error).message?.slice(0, 200));
    return { text: null, reason: kind === "pdf" ? "pdf_unreadable" : kind === "docx" ? "bad_docx" : "failed" };
  }
}

// deno-lint-ignore no-explicit-any
async function runExtraction(admin: any, doc: { id: string; storage_path: string; file_kind: DocKind; sap_module: string; sap_version: string | null; tags: string[]; language: string }, bytes?: Uint8Array) {
  const { data: claimed } = await admin.rpc("ik_claim_document", { _id: doc.id });
  if (claimed !== true) return { status: "busy" as const };
  try {
    let data = bytes;
    if (!data) {
      const dl = await admin.storage.from(KNOWLEDGE_BUCKET).download(doc.storage_path);
      if (dl.error || !dl.data) throw new Error("download");
      data = new Uint8Array(await dl.data.arrayBuffer());
    }
    const { text, reason } = await extractText(doc.file_kind, data);
    await admin.from("interview_knowledge_chunks").delete().eq("document_id", doc.id);
    if (text === null) {
      await admin.from("interview_knowledge_documents").update({ status: "failed", status_reason: STATUS_REASONS[reason ?? "failed"], chunk_count: 0, text_chars: 0 }).eq("id", doc.id);
      return { status: "failed" as const, reason };
    }
    const clean = cleanText(text);
    const pii = scanPersonalData(clean);
    if (clean.replace(/\s+/g, "").length < MIN_DOCUMENT_TEXT) {
      await admin.from("interview_knowledge_documents").update({ status: "no_text", status_reason: STATUS_REASONS.no_text, chunk_count: 0, text_chars: clean.length, pii_flags: pii }).eq("id", doc.id);
      return { status: "no_text" as const, pii };
    }
    const chunks = chunkText(clean);
    const rows = chunks.map((body, i) => ({ document_id: doc.id, chunk_no: i + 1, body: body.slice(0, 2000), sap_module: doc.sap_module, sap_version: doc.sap_version, tags: doc.tags, language: doc.language }));
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await admin.from("interview_knowledge_chunks").insert(rows.slice(i, i + 100));
      if (error) throw new Error(`chunks: ${error.message}`);
    }
    await admin.from("interview_knowledge_documents").update({ status: "ready", status_reason: null, chunk_count: rows.length, text_chars: clean.length, pii_flags: pii }).eq("id", doc.id);
    return { status: "ready" as const, chunks: rows.length, pii };
  } catch (e) {
    console.error("extraction failed:", (e as Error).message?.slice(0, 200));
    await admin.from("interview_knowledge_documents").update({ status: "failed", status_reason: STATUS_REASONS.failed }).eq("id", doc.id);
    return { status: "failed" as const, reason: "failed" };
  }
}

// deno-lint-ignore no-explicit-any
async function ensureBucket(admin: any) {
  const { data } = await admin.storage.getBucket(KNOWLEDGE_BUCKET);
  if (data) return;
  const { error } = await admin.storage.createBucket(KNOWLEDGE_BUCKET, { public: false, fileSizeLimit: MAX_DOCUMENT_BYTES });
  if (error && !/exists/i.test(error.message)) throw new Error(`bucket: ${error.message}`);
}

// deno-lint-ignore no-explicit-any
async function audit(admin: any, userId: string, action: string, entityId: string | null, metadata: Record<string, unknown>) {
  await admin.from("audit_logs").insert({ user_id: userId, action, entity_type: "interview_knowledge_document", entity_id: entityId, metadata });
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const user = await authenticateUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    const admin = adminClient();
    if (!hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES)) return json({ error: "Forbidden" }, 403);
    if (!(await knowledgeTablesReady(admin))) return json({ error: "not_ready", message: "The database update for knowledge documents is not applied yet." }, 409);
    const settings = await loadKnowledgeSettings(admin);

    const type = req.headers.get("content-type") || "";
    if (type.startsWith("multipart/form-data")) {
      if (!(await withinRateLimit(admin, `ik-upload:${user.id}`, 30, 3600))) return json({ error: "rate_limited", message: "Too many uploads. Please wait a while." }, 429);
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "no_file" }, 400);
      let metaRaw: unknown = null;
      try { metaRaw = JSON.parse(String(form.get("meta") || "{}")); } catch { metaRaw = null; }
      const meta = Meta.safeParse(metaRaw);
      if (!meta.success) return json({ error: "invalid_meta", fields: meta.error.flatten().fieldErrors }, 400);
      if (file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) return json({ error: "too_large", message: STATUS_REASONS.too_large }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > MAX_DOCUMENT_BYTES) return json({ error: "too_large", message: STATUS_REASONS.too_large }, 400);
      const kind = sniffDocument(bytes, file.name);
      if (!kind) return json({ error: "wrong_type", message: STATUS_REASONS.wrong_type, accept: ACCEPT_ATTRIBUTE }, 400);
      const sha = await sha256Hex(bytes);
      const { data: dup } = await admin.from("interview_knowledge_documents").select("id, title").eq("sha256", sha).maybeSingle();
      if (dup) return json({ error: "duplicate", message: `This file is already uploaded as "${dup.title}".` }, 409);
      // caps: documents per module and total size
      const { data: all } = await admin.from("interview_knowledge_documents").select("sap_module, size_bytes");
      const key = (m: string) => m.toLowerCase().replace(/^sap\s+/, "").replace(/[^a-z0-9/]+/g, " ").trim();
      const sameModule = (all || []).filter((d: any) => key(d.sap_module) === key(meta.data.sap_module)).length;
      if (sameModule >= settings.max_docs_per_module) return json({ error: "module_cap", message: `This module already has ${sameModule} documents (limit ${settings.max_docs_per_module}).` }, 409);
      const totalBytes = (all || []).reduce((a: number, d: any) => a + Number(d.size_bytes || 0), 0) + bytes.length;
      if (totalBytes > settings.max_total_mb * 1024 * 1024) return json({ error: "total_cap", message: `The total size limit of ${settings.max_total_mb} MB would be exceeded.` }, 409);

      await ensureBucket(admin);
      const id = crypto.randomUUID();
      const fileName = safeFileName(file.name);
      const storagePath = `${id}/${fileName}`;
      const docRow = {
        id, title: meta.data.title, sap_module: meta.data.sap_module, sap_version: cleanVersion(meta.data.sap_version), language: meta.data.language,
        tags: tags(meta.data.tags), enabled: meta.data.enabled, notes: meta.data.notes?.trim() || null, file_name: fileName, storage_path: storagePath,
        file_kind: kind, size_bytes: bytes.length, sha256: sha, status: "uploaded", rights_confirmed: true, rights_confirmed_by: user.id, uploaded_by: user.id,
      };
      const { error: insErr } = await admin.from("interview_knowledge_documents").insert(docRow);
      if (insErr) return json({ error: "save_failed", message: "The document could not be saved." }, 400);
      const up = await admin.storage.from(KNOWLEDGE_BUCKET).upload(storagePath, bytes, { contentType: KIND_MIME[kind], upsert: false });
      if (up.error) {
        await admin.from("interview_knowledge_documents").delete().eq("id", id);
        return json({ error: "storage_failed", message: "The file could not be stored. Please try again." }, 502);
      }
      await audit(admin, user.id, "interview_knowledge_uploaded", id, { title: docRow.title, module: docRow.sap_module, version: docRow.sap_version, kind, size: bytes.length, rights_confirmed_at: new Date().toISOString() });
      const result = await runExtraction(admin, { ...docRow, file_kind: kind }, bytes);
      return json({ document_id: id, ...result });
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "invalid_input" }, 400);
    const body = parsed.data;

    if (body.action === "update") {
      const { data: before } = await admin.from("interview_knowledge_documents").select("id, title, sap_module, sap_version, language, tags, enabled, notes").eq("id", body.document_id).maybeSingle();
      if (!before) return json({ error: "not_found" }, 404);
      const patch: Record<string, unknown> = {};
      if (body.title !== undefined) patch.title = body.title;
      if (body.sap_module !== undefined) patch.sap_module = body.sap_module;
      if (body.sap_version !== undefined) patch.sap_version = cleanVersion(body.sap_version);
      if (body.language !== undefined) patch.language = body.language;
      if (body.tags !== undefined) patch.tags = tags(body.tags);
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.notes !== undefined) patch.notes = body.notes?.trim() || null;
      const { error } = await admin.from("interview_knowledge_documents").update(patch).eq("id", body.document_id);
      if (error) return json({ error: "save_failed", message: "Could not save the changes." }, 400);
      await audit(admin, user.id, "interview_knowledge_updated", body.document_id, { before, after: patch });
      return json({ ok: true });
    }

    if (body.action === "delete") {
      const { data: doc } = await admin.from("interview_knowledge_documents").select("id, title, sap_module, sap_version, storage_path").eq("id", body.document_id).maybeSingle();
      if (!doc) return json({ error: "not_found" }, 404);
      const rm = await admin.storage.from(KNOWLEDGE_BUCKET).remove([doc.storage_path]);
      if (rm.error && !/not.?found/i.test(rm.error.message)) return json({ error: "storage_failed", message: "The file could not be deleted. Nothing was changed." }, 502);
      const { error } = await admin.from("interview_knowledge_documents").delete().eq("id", doc.id); // chunks cascade
      if (error) return json({ error: "delete_failed" }, 500);
      await audit(admin, user.id, "interview_knowledge_deleted", doc.id, { title: doc.title, module: doc.sap_module, version: doc.sap_version, reason: body.reason });
      return json({ ok: true });
    }

    if (body.action === "reextract") {
      if (!(await withinRateLimit(admin, `ik-reextract:${user.id}`, 20, 3600))) return json({ error: "rate_limited" }, 429);
      const { data: doc } = await admin.from("interview_knowledge_documents").select("id, storage_path, file_kind, sap_module, sap_version, tags, language, attempts").eq("id", body.document_id).maybeSingle();
      if (!doc) return json({ error: "not_found" }, 404);
      if (doc.attempts >= 5) await admin.from("interview_knowledge_documents").update({ attempts: 0 }).eq("id", doc.id); // an admin press resets the automatic cap
      await audit(admin, user.id, "interview_knowledge_reextracted", doc.id, {});
      const result = await runExtraction(admin, doc);
      return json({ document_id: doc.id, ...result });
    }

    // preview for a consultant: plan + 5 sample questions with their sources; nothing is stored
    if (!(await withinRateLimit(admin, `ik-preview:${user.id}`, 15, 3600))) return json({ error: "rate_limited", message: "Too many previews. Please wait a while." }, 429);
    const { data: consultant } = await admin.from("consultants").select("id").eq("id", body.consultant_id).maybeSingle();
    if (!consultant) return json({ error: "not_found" }, 404);
    const built = await buildPlanAndQuestions(admin, {
      consultantId: body.consultant_id, seed: `preview|${body.consultant_id}|${Date.now()}`, lang: body.lang, settings,
      apiKey: Deno.env.get("LOVABLE_API_KEY") ?? null, maxAiCalls: 1, sampleSize: 5,
    });
    // official SAP links for ADMINS only, and only when an administrator switched an imported SAP documentation source on
    const references: Array<{ title: string; url: string }> = [];
    const terms = built.plan.items.flatMap((i) => [i.module, i.version ?? ""]).join(" ").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2).slice(0, 6);
    if (terms.length >= 2) {
      const { data: refs } = await admin.rpc("search_sap_docs", { _terms: terms, _limit: 3 });
      for (const r of Array.isArray(refs) ? refs : []) {
        if (isSapDocsRepo(r.repo) && isBranchName(r.branch) && typeof r.path === "string") references.push({ title: String(r.doc_title || "").slice(0, 160), url: docUrl(r.repo, r.branch, r.path) });
      }
    }
    console.log(JSON.stringify({ tag: "interview-preview", ...built.usage, error: built.error }));
    return json({ plan: built.plan, questions: built.questions, sources: built.adminSources, coverage_notes: built.coverageNotes, usage: built.usage, error: built.error, references, enabled: settings.enabled });
  } catch (e) {
    console.error("interview-knowledge:", (e as Error).message?.slice(0, 300));
    return json({ error: "failed", message: "Something went wrong. Please try again." }, 500);
  }
});
