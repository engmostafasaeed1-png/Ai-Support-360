// A consultant or an administrator writes a knowledge article by hand.
// It is stored as a DRAFT: an administrator must review and publish it, and nothing is shown to a client before that.
// The text is scrubbed (e-mails, links, numbers, the writer's own name and company ...) and what the scrub removed is recorded for the reviewer.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders as getCorsHeaders, adminClient, withinRateLimit, getUserRoles, hasAnyRole, ADMIN_ROLES } from "../_shared/security.ts";
import { buildDenyList, cleanTags, saveKnowledgeDraft } from "../_shared/knowledge.ts";
import type { DenyTerm } from "../_shared/scrub.ts";

const MAX_BODY_SIZE = 40 * 1024;
const MAX_SOLUTION = 6000;

const BodySchema = z.object({
  title: z.string().trim().min(5).max(200),
  problem: z.string().trim().min(20).max(2000),
  solution: z.string().trim().min(20).max(MAX_SOLUTION),
  areas: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  tags: z.array(z.string().max(40)).max(12).optional(),
  note_numbers: z.array(z.string().regex(/^\d{5,8}$/)).max(8).optional(),
  confirmed: z.literal(true),
});

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
    if (!hasAnyRole(roles, ["consultant", ...ADMIN_ROLES])) return json({ error: "Forbidden" }, 403);
    if (!(await withinRateLimit(admin, `knowledge-submit:${user.id}`, 10, 60, true))) {
      return json({ error: "Rate limit exceeded. Please wait before sending more requests." }, 429, { "Retry-After": "60" });
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
    if (!parsed.success) return json({ error: "Please fill in every field and confirm the statement." }, 400);
    const b = parsed.data;

    // the writer's own name, e-mail address and company must not stay in the text
    let deny: DenyTerm[] = [];
    try {
      deny = await buildDenyList(admin, { client_id: user.id, consultant_id: null, tenant_id: null }, []);
    } catch (e) {
      console.warn("deny list failed:", e instanceof Error ? e.message : String(e));
    }

    // one line per note number, so that the privacy check keeps every number (a list of long numbers would be mistaken for document numbers)
    const noteBlock = [...new Set(b.note_numbers ?? [])].map((n) => `SAP Note ${n}`).join("\n");
    const solution = noteBlock ? `${b.solution.slice(0, MAX_SOLUTION - noteBlock.length - 2)}\n\n${noteBlock}` : b.solution;

    const result = await saveKnowledgeDraft(admin, {
      title: b.title,
      problem: b.problem,
      solution,
      areas: b.areas,
      tags: cleanTags(b.tags),
      ticketId: null,
      consultantId: null, // an article written by hand is not a solved case: it earns nobody a "solved before" count
      originKind: "manual",
      createdBy: user.id,
      deny,
    });
    if (result.status === "created") return json({ status: "created", flags: result.flags });
    return json({ error: result.reason }, result.status === "skipped" ? 409 : 500);
  } catch (e) {
    console.error("knowledge-submit error:", e instanceof Error ? e.message : String(e));
    return json({ error: "Request failed. Please try again." }, 500);
  }
});
