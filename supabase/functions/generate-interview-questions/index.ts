import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders as sharedCorsHeaders, adminClient, authenticateUser, getUserRoles, hasAnyRole, ADMIN_ROLES, withinRateLimit } from "../_shared/security.ts";

const Body = z.object({
  sap_module: z.string().min(1).max(60),
  difficulty: z.enum(["easy", "medium", "hard", "expert"]),
  count: z.number().int().min(1).max(10),
  topic: z.string().max(300).optional(),
});

serve(async (req) => {
  const cors = sharedCorsHeaders(req);
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const user = await authenticateUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    const admin = adminClient();
    if (!hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES)) return json({ error: "Forbidden" }, 403);
    if (!(await withinRateLimit(admin, `gen-iq:${user.id}`, 10, 60, true))) return json({ error: "Too many requests, wait a minute." }, 429);

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Invalid input" }, 400);
    const { sap_module, difficulty, count, topic } = parsed.data;

    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "AI not configured" }, 500);

    const prompt = `Write ${count} SAP job-interview questions for the module "${sap_module}" at ${difficulty} difficulty${topic ? `, focused on: ${topic}` : ""}.
For each give a model best answer (4-8 sentences, concrete: transactions, tables, config steps, real project practice) and key points an interviewer should listen for.
Respond with JSON only, no markdown: {"questions":[{"question":"...","best_answer":"...","key_points":"comma-separated points","category":"short category"}]}`;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Lovable-API-Key": key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        instructions: "You are a senior SAP hiring expert. Output valid JSON only.",
        input: prompt,
      }),
    });
    if (!r.ok || !r.body) {
      const t = await r.text().catch(() => "");
      console.error("gateway", r.status, t.slice(0, 300));
      const msg = r.status === 402 ? "AI credits exhausted. Add credits in workspace settings." : r.status === 429 ? "AI is busy, try again shortly." : "AI generation failed.";
      return json({ error: msg }, r.status === 402 || r.status === 429 || r.status === 403 ? r.status : 502);
    }

    // Consume SSE stream, collect output text
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "", text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const ev = JSON.parse(data);
          if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") text += ev.delta;
        } catch { /* partial */ }
      }
    }

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json({ error: "AI returned no questions. Try again." }, 502);
    const out = JSON.parse(match[0]);
    const questions = (Array.isArray(out.questions) ? out.questions : [])
      .filter((q: any) => typeof q?.question === "string" && q.question.trim())
      .slice(0, count)
      .map((q: any) => ({
        question: String(q.question).slice(0, 2000),
        best_answer: String(q.best_answer || "").slice(0, 6000),
        key_points: String(q.key_points || "").slice(0, 1000),
        category: String(q.category || "").slice(0, 100),
      }));
    return json({ questions });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong" }, 500);
  }
});
