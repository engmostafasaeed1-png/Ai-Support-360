// Imports SAP's open documentation (github.com/SAP-docs, licence CC BY 4.0) into the search tables. Administrators only.
// The work is done in small steps so that no single call runs long: "start" reads the file list of one source and empties its old import,
// "step" reads the next pages (the screen calls it again and again until it answers done), "remove" empties a source.
// Only repositories of the SAP-docs organisation are read. The text is stored for the search only and is always shown with its source and licence.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders as getCorsHeaders, adminClient, withinRateLimit, getUserRoles, hasAnyRole, ADMIN_ROLES } from "../_shared/security.ts";
import { isBranchName, isSapDocsRepo, parseDoc, rawFileUrl, selectDocFiles, treeApiUrl, type ParsedDoc } from "../_shared/sapDocs.ts";

const MAX_BODY_SIZE = 2 * 1024;
const BATCH_FILES = 24;
const BATCH_BYTES = 500_000;
const BUDGET_MS = 45_000;
const FETCH_TIMEOUT_MS = 15_000;
const PARALLEL = 6;
const STALE_MS = 5 * 60 * 1000;
const DELETE_BATCH = 1500;
const INSERT_BATCH = 100;
const USER_AGENT = "AI-SAP-Support-Now/1.0 (documentation import; https://www.aisapsupportnow.com)";

const BodySchema = z.object({
  action: z.enum(["start", "step", "remove"]),
  source_id: z.string().regex(/^[a-z0-9-]{3,60}$/),
});

interface Source {
  id: string;
  repo: string;
  branch: string;
  status: string;
  enabled: boolean;
  files_total: number;
  files_done: number;
  chunk_count: number;
  text_bytes: number;
  updated_at: string;
}

const SOURCE_COLUMNS = "id, title, repo, branch, license, enabled, status, commit_sha, files_total, files_done, chunk_count, text_bytes, imported_at, last_error, updated_at";

async function fetchText(url: string, accept?: string): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (accept) headers.Accept = accept;
    // an optional token only lifts GitHub's limit for anonymous requests; it is never required
    const token = Deno.env.get("SAP_DOCS_GITHUB_TOKEN");
    if (token && url.startsWith("https://api.github.com/")) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers, signal: ctrl.signal });
    return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : "" };
  } catch {
    return { ok: false, status: 0, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

// deno-lint-ignore no-explicit-any
type Admin = any;

/** Deletes the chunks of a source in small batches (a big delete in one statement could run into a time limit). Returns false when the time ran out. */
async function deleteChunks(admin: Admin, sourceId: string, deadline: number): Promise<boolean> {
  for (;;) {
    const { data, error } = await admin.from("sap_doc_chunks").select("id").eq("source_id", sourceId).limit(DELETE_BATCH);
    if (error) throw new Error(error.message);
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (ids.length === 0) return true;
    const { error: delError } = await admin.from("sap_doc_chunks").delete().in("id", ids);
    if (delError) throw new Error(delError.message);
    if (Date.now() > deadline) {
      const { data: more } = await admin.from("sap_doc_chunks").select("id").eq("source_id", sourceId).limit(1);
      return !more || more.length === 0;
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders(req) });
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...getCorsHeaders(req), "Content-Type": "application/json", ...extra } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const supabaseAuth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid or expired session" }, 401);

    const admin = adminClient();
    const roles = await getUserRoles(admin, user.id);
    if (!hasAnyRole(roles, ADMIN_ROLES)) return json({ error: "Forbidden" }, 403);
    if (!(await withinRateLimit(admin, `sap-docs-import:${user.id}`, 120, 60, false))) {
      return json({ error: "Rate limit exceeded. Please wait a moment." }, 429, { "Retry-After": "60" });
    }

    const bodyText = await req.text();
    if (bodyText.length > MAX_BODY_SIZE) return json({ error: "Request too large" }, 413);
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = BodySchema.safeParse(parsedBody);
    if (!parsed.success) return json({ error: "Invalid request" }, 400);
    const { action, source_id: sourceId } = parsed.data;

    const { data: found, error: sourceError } = await admin.from("sap_doc_sources").select(SOURCE_COLUMNS).eq("id", sourceId).maybeSingle();
    if (sourceError) throw new Error(sourceError.message);
    if (!found) return json({ error: "Unknown source" }, 404);
    const src = found as Source;
    if (!isSapDocsRepo(src.repo) || !isBranchName(src.branch)) return json({ error: "This source is not allowed" }, 400);

    const reload = async () => {
      const { data } = await admin.from("sap_doc_sources").select(SOURCE_COLUMNS).eq("id", sourceId).maybeSingle();
      return data;
    };
    // an expected problem (GitHub does not answer, the page list is too large ...) is answered with status 200 and ok:false,
    // so that the screen can show the message; "remember" also keeps it in the source row
    const soft = async (message: string, remember = false) => {
      if (remember) await admin.from("sap_doc_sources").update({ last_error: message.slice(0, 300) }).eq("id", sourceId);
      return json({ ok: false, error: message, source: await reload() });
    };
    const started = Date.now();

    // ------------------------------------------------------------------ remove
    if (action === "remove") {
      if (!(await deleteChunks(admin, sourceId, started + BUDGET_MS))) return await soft("Emptying took too long. Press Remove again.");
      await admin.from("sap_doc_files").delete().eq("source_id", sourceId);
      await admin.from("sap_doc_sources").update({
        status: "empty", enabled: false, commit_sha: null, files_total: 0, files_done: 0, chunk_count: 0, text_bytes: 0, imported_at: null, last_error: null,
      }).eq("id", sourceId);
      return json({ ok: true, done: true, source: await reload() });
    }

    // ------------------------------------------------------------------ start
    if (action === "start") {
      if (src.status === "importing" && Date.now() - new Date(src.updated_at).getTime() < STALE_MS) {
        return await soft("An import of this source is already running.");
      }
      const treeRes = await fetchText(treeApiUrl(src.repo, src.branch), "application/vnd.github+json");
      if (!treeRes.ok) {
        const why = treeRes.status === 403 || treeRes.status === 429
          ? "GitHub's limit for anonymous requests is used up. Try again in an hour."
          : `GitHub did not answer (status ${treeRes.status || "no answer"}). Try again later.`;
        return await soft(why, true);
      }
      // deno-lint-ignore no-explicit-any
      let tree: any = null;
      try {
        tree = JSON.parse(treeRes.text);
      } catch { /* handled below */ }
      if (!tree || !Array.isArray(tree.tree)) return await soft("GitHub sent an answer that could not be read.", true);
      if (tree.truncated === true) return await soft("The list of pages is too large to read in one request.", true);
      const files = selectDocFiles(tree.tree);
      if (files.length === 0) return await soft("No documentation pages were found in this repository.", true);

      if (!(await deleteChunks(admin, sourceId, started + BUDGET_MS))) return await soft("Emptying the old import took too long. Press Import again.", true);
      await admin.from("sap_doc_files").delete().eq("source_id", sourceId);
      for (let i = 0; i < files.length; i += 500) {
        const rows = files.slice(i, i + 500).map((f) => ({ source_id: sourceId, path: f.path, bytes: f.bytes, done: false }));
        const { error } = await admin.from("sap_doc_files").insert(rows);
        if (error) return await soft("The list of pages could not be saved.", true);
      }
      await admin.from("sap_doc_sources").update({
        status: "importing",
        commit_sha: typeof tree.sha === "string" ? tree.sha.slice(0, 80) : null,
        files_total: files.length,
        files_done: 0,
        chunk_count: 0,
        text_bytes: 0,
        imported_at: null,
        last_error: null,
      }).eq("id", sourceId);
      return json({ ok: true, done: false, source: await reload() });
    }

    // ------------------------------------------------------------------ step
    if (src.status !== "importing") return await soft("Start the import first.");

    const { data: pending, error: pendingError } = await admin.from("sap_doc_files")
      .select("path, bytes").eq("source_id", sourceId).eq("done", false).order("path").limit(BATCH_FILES);
    if (pendingError) throw new Error(pendingError.message);
    const queue = (pending ?? []) as Array<{ path: string; bytes: number }>;

    if (queue.length === 0) {
      const { count: chunkCount } = await admin.from("sap_doc_chunks").select("id", { count: "exact", head: true }).eq("source_id", sourceId);
      const { count: failedCount } = await admin.from("sap_doc_files").select("path", { count: "exact", head: true }).eq("source_id", sourceId).eq("done", true).eq("bytes", 0);
      await admin.from("sap_doc_sources").update({
        status: "ready",
        files_done: src.files_total,
        chunk_count: chunkCount ?? src.chunk_count,
        imported_at: new Date().toISOString(),
        last_error: failedCount ? `${failedCount} page(s) could not be read. Press Update to try again.` : null,
      }).eq("id", sourceId);
      return json({ ok: true, done: true, source: await reload() });
    }

    const batch: Array<{ path: string; bytes: number }> = [];
    let batchBytes = 0;
    for (const f of queue) {
      if (batch.length > 0 && batchBytes + f.bytes > BATCH_BYTES) break;
      batch.push(f);
      batchBytes += f.bytes;
    }

    const results: Array<{ path: string; doc: ParsedDoc | null; failed: boolean }> = [];
    for (let i = 0; i < batch.length; i += PARALLEL) {
      if (Date.now() - started > BUDGET_MS) break;
      const part = batch.slice(i, i + PARALLEL);
      const read = await Promise.all(part.map(async (f) => {
        const res = await fetchText(rawFileUrl(src.repo, src.branch, f.path));
        if (!res.ok) return { path: f.path, doc: null, failed: res.status !== 404 };
        return { path: f.path, doc: parseDoc(f.path, res.text), failed: false };
      }));
      results.push(...read);
    }
    if (results.length === 0) return await soft("GitHub did not answer in time. Press Continue.");
    if (results.every((r) => r.failed)) return await soft("GitHub did not answer. Press Continue to try again.");

    // chunks first (an earlier, interrupted try of the same pages is replaced), then the pages are marked done
    const paths = results.map((r) => r.path);
    const { error: clearError } = await admin.from("sap_doc_chunks").delete().eq("source_id", sourceId).in("path", paths);
    if (clearError) throw new Error(clearError.message);
    const rows: Array<Record<string, unknown>> = [];
    for (const r of results) {
      if (!r.doc) continue;
      for (const c of r.doc.chunks) rows.push({ source_id: sourceId, path: r.path, chunk_no: c.chunkNo, doc_title: r.doc.title, heading: c.heading, body: c.body });
    }
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const { error } = await admin.from("sap_doc_chunks").insert(rows.slice(i, i + INSERT_BATCH));
      if (error) throw new Error(error.message);
    }
    // only the pages this call marks done are counted (a second screen doing the same pages counts nothing twice)
    const { data: claimed, error: claimError } = await admin.from("sap_doc_files")
      .update({ done: true }).eq("source_id", sourceId).eq("done", false).in("path", paths).select("path");
    if (claimError) throw new Error(claimError.message);
    const mine = new Set(((claimed ?? []) as Array<{ path: string }>).map((c) => c.path));
    const failedPaths = results.filter((r) => r.failed && mine.has(r.path)).map((r) => r.path);
    if (failedPaths.length > 0) await admin.from("sap_doc_files").update({ bytes: 0 }).eq("source_id", sourceId).in("path", failedPaths);
    let addedChunks = 0;
    let addedBytes = 0;
    for (const r of results) {
      if (!r.doc || !mine.has(r.path)) continue;
      addedChunks += r.doc.chunks.length;
      addedBytes += r.doc.textBytes;
    }
    await admin.from("sap_doc_sources").update({
      files_done: Math.min(src.files_total, src.files_done + mine.size),
      chunk_count: src.chunk_count + addedChunks,
      text_bytes: src.text_bytes + addedBytes,
    }).eq("id", sourceId);
    return json({ ok: true, done: false, failed: failedPaths.length, source: await reload() });
  } catch (e) {
    console.error("sap-docs-import error:", e instanceof Error ? e.message : String(e));
    return json({ error: "The import stopped because of an error. Please try again." }, 500);
  }
});
