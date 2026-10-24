// AI assist for Solution Architecture documents: "Draft from my BRD / ticket", "Suggest components and
// integrations", "Review for gaps and risks". Same guardrails and stream format as ticket-brd.
//
// Security
// - Signed-in callers only (JWT checked in code). Every call first claims a slot with the service-only sa_ai_claim
//   RPC: feature + AI switch (both default OFF), writer check (owning company writer or admin), per-document and
//   per-company daily limits under a lock, model from settings, token log via sa_ai_finish.
// - Context comes only from the service-only sa_ai_context RPC (re-checks writer and that the ticket is linked and
//   readable); ticket, BRD and document text are untrusted data (brdPrompt.wrapTicketData). The answer is a forced
//   tool call validated by archPrompt, escaped to HTML and scrubbed of secrets and contact details (brdSafety).
// - Nothing is saved here: the browser shows the result for review and asks before replacing any text; the save
//   RPCs check and mask everything again.

import { z } from 'https://esm.sh/zod@3.23.8';
import { adminClient, authenticateUser, corsHeaders, jsonResponse, preflight } from '../_shared/security.ts';
import { extractFirstFunctionCall, responsesRequest, userTextItem } from '../_shared/aiResponses.ts';
import { wrapTicketData } from '../_shared/brdPrompt.ts';
import { cleanText } from '../_shared/brdSafety.ts';
import { htmlToText } from '../_shared/brdModel.ts';
import { normalizeArchContent, type ArchMeta, type ArchType } from '../_shared/archModel.ts';
import { ArchOutputError, archInstructions, archParts, archTool, parseArchDraft, parseComponents, parseReview, toolName, type ArchAiAction } from '../_shared/archPrompt.ts';

const Body = z.object({
  action: z.enum(['arch_draft', 'arch_components', 'arch_review']),
  docId: z.string().uuid(),
  ticketId: z.string().uuid().nullable().optional(),
  content: z.unknown(),
  language: z.enum(['en', 'ar']),
});

type GatewayFailure = { code: string; status: number; message: string };
function gatewayFailure(status: number, upstream: string): GatewayFailure {
  if (status === 402) return { code: 'credits', status, message: upstream || 'The AI credits for this workspace have run out. Please try again later.' };
  if (status === 429) return { code: 'busy', status, message: 'The AI service is busy right now. Please wait a minute and try again.' };
  if (status === 403) return { code: 'denied', status, message: upstream || 'The AI service declined this request.' };
  if (status === 400) return { code: 'bad_request', status, message: 'The AI could not process this document. You can write it yourself.' };
  return { code: 'unavailable', status, message: 'The AI service is not available right now. Please try again later.' };
}

async function readStream(res: Response, tick: () => void): Promise<Record<string, unknown>> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let final: Record<string, unknown> | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let ev: Record<string, any>;
      try { ev = JSON.parse(data); } catch { continue; }
      tick();
      if ((ev.type === 'response.completed' || ev.type === 'response.incomplete') && ev.response) final = ev.response;
      else if (ev.type === 'response.failed') throw Object.assign(new Error('failed'), { gateway: gatewayFailure(500, '') });
      else if (ev.type === 'error') {
        const code = String(ev.code ?? ev.error?.code ?? '');
        const status = /insufficient|credit|402/.test(code) ? 402 : /rate|429/.test(code) ? 429 : /denied|forbidden|403|refus/.test(code) ? 403 : 500;
        throw Object.assign(new Error('failed'), { gateway: gatewayFailure(status, typeof ev.message === 'string' ? ev.message.slice(0, 300) : '') });
      }
    }
  }
  if (!final) throw Object.assign(new Error('incomplete'), { gateway: gatewayFailure(500, '') });
  return final;
}

async function upstreamMessage(res: Response): Promise<string> {
  try { const j = await res.json(); const m = j?.error?.message ?? j?.message; return typeof m === 'string' ? m.slice(0, 300) : ''; } catch { return ''; }
}

const clean = (html: string) => { const c = cleanText(html); return { html: c.text, secrets: c.secrets, contacts: c.contacts }; };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const user = await authenticateUser(req);
  if (!user) return jsonResponse(req, { error: 'Please sign in again.' }, 401);
  let raw: unknown;
  try { raw = await req.json(); } catch { return jsonResponse(req, { error: 'Invalid request' }, 400); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonResponse(req, { error: 'Invalid request' }, 400);
  const body = parsed.data;
  const action = body.action as ArchAiAction;
  const admin = adminClient();

  const { data: claim, error: claimError } = await admin.rpc('sa_ai_claim', { _doc: body.docId, _actor: user.id, _kind: action });
  if (claimError) return jsonResponse(req, { error: 'The architecture assistant is not available yet.', code: 'not_ready' }, 503);
  const c = (claim ?? {}) as { ok?: boolean; reason?: string; id?: string; model?: string; max_brd_chars?: number };
  if (!c.ok) {
    const status = c.reason === 'not_allowed' ? 403 : c.reason === 'ai_off' ? 403 : 429;
    return jsonResponse(req, { error: c.reason ?? 'not_allowed', code: c.reason ?? 'not_allowed' }, status);
  }
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey || !c.model || !c.id) {
    await admin.rpc('sa_ai_finish', { _id: c.id, _status: 'failed', _input: 0, _output: 0, _reason: 'configuration' });
    return jsonResponse(req, { error: 'The architecture assistant is not configured.' }, 500);
  }
  const usageId = c.id;
  const { data: ctx, error: ctxError } = await admin.rpc('sa_ai_context', { _doc: body.docId, _actor: user.id, _ticket: body.ticketId ?? null });
  if (ctxError || !ctx) {
    await admin.rpc('sa_ai_finish', { _id: usageId, _status: 'failed', _input: 0, _output: 0, _reason: 'context' });
    return jsonResponse(req, { error: 'The linked ticket cannot be used.' }, 400);
  }
  const meta = (ctx as { meta: ArchMeta }).meta;
  const type = meta.type as ArchType;
  const content = normalizeArchContent(body.content, type);
  const brd = (ctx as { brd?: { sections?: Array<{ html?: string }>; requirements?: Array<{ id?: string; description?: string }> } | null }).brd ?? null;
  const t = (ctx as { ticket?: { ref: string; title: string; description: string; sap_module: string } | null }).ticket ?? null;
  const requirements = (brd?.requirements ?? []).filter((r) => /^REQ-\d{3}$/.test(String(r.id))).slice(0, 80)
    .map((r) => ({ ticket_ref: t?.ref ?? '', req_id: String(r.id), description: String(r.description ?? '').slice(0, 300) }));
  const brdText = (brd?.sections ?? []).map((s) => htmlToText(String(s.html ?? ''))).join('\n').trim();
  const data = wrapTicketData(archParts({
    meta, ticket: t, brdText, requirements, content: action === 'arch_draft' ? null : content, maxBrdChars: c.max_brd_chars,
    systems: (ctx as { systems?: Array<{ name: string; sid: string; role: string; product: string; release: string; hosting: string }> }).systems ?? [],
  }));

  const enc = new TextEncoder();
  const ac = new AbortController();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (obj: unknown) => { if (!closed) { try { ctrl.enqueue(enc.encode(JSON.stringify(obj) + '\n')); } catch { /* closed */ } } };
      let lastTick = 0;
      const tick = () => { const now = Date.now(); if (now - lastTick > 4000) { lastTick = now; send({ type: 'progress', step: 'writing' }); } };
      const heartbeat = setInterval(() => send({ type: 'progress', step: 'thinking' }), 10_000);
      send({ type: 'progress', step: 'reading', dropped: data.dropped, truncated: data.truncated, included: data.included });
      let inTok = 0, outTok = 0;
      try {
        const res = await responsesRequest({
          apiKey, model: c.model!, instructions: archInstructions(action, type, body.language), input: [userTextItem(data.block || '<ticket_data></ticket_data>')],
          tools: [archTool(action, type)], toolChoice: { type: 'function', name: toolName(action) }, stream: true, effort: 'low', signal: ac.signal,
        });
        if (!res.ok || !res.body) throw Object.assign(new Error('upstream'), { gateway: gatewayFailure(res.status, await upstreamMessage(res)) });
        send({ type: 'progress', step: 'writing' });
        const final = await readStream(res, tick);
        const usage = (final.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
        inTok = usage.input_tokens ?? 0; outTok = usage.output_tokens ?? 0;
        const call = extractFirstFunctionCall(final);
        if (!call) throw Object.assign(new Error('no_call'), { gateway: { code: 'no_answer', status: 502, message: 'The AI did not return an answer this time. Please try again later.' } });
        send({ type: 'progress', step: 'checking' });
        let secrets = 0, contacts = 0;
        const count = (x: { secrets: number; contacts: number }) => { secrets += x.secrets; contacts += x.contacts; };
        if (action === 'arch_draft') {
          const sections = parseArchDraft(call.arguments, type, body.language, requirements).map((s) => { const x = clean(s.html); count(x); return { ...s, html: x.html }; });
          send({ type: 'result', kind: 'draft', sections, report: { secrets, contacts, dropped: data.dropped, truncated: data.truncated } });
        } else if (action === 'arch_components') {
          const p = parseComponents(call.arguments, body.language);
          const a = clean(p.components); const b = clean(p.integrations); count(a); count(b);
          send({ type: 'result', kind: 'components', components: a.html, integrations: b.html, report: { secrets, contacts, dropped: data.dropped, truncated: data.truncated } });
        } else {
          const findings = parseReview(call.arguments, type).map((f) => {
            const a = cleanText(f.finding); const b = cleanText(f.suggestion); count(a); count(b);
            return { ...f, finding: a.text, suggestion: b.text };
          });
          send({ type: 'result', kind: 'review', findings, report: { secrets, contacts, dropped: data.dropped, truncated: data.truncated } });
        }
        await admin.rpc('sa_ai_finish', { _id: usageId, _status: 'ok', _input: inTok, _output: outTok, _reason: null });
      } catch (e) {
        const aborted = ac.signal.aborted;
        const g: GatewayFailure = (e as { gateway?: GatewayFailure }).gateway
          ?? (e instanceof ArchOutputError
            ? { code: 'invalid_output', status: 502, message: 'The AI answer could not be used. You can write it yourself or try again later.' }
            : { code: aborted ? 'stopped' : 'error', status: aborted ? 499 : 500, message: aborted ? 'Stopped.' : 'Something went wrong.' });
        await admin.rpc('sa_ai_finish', { _id: usageId, _status: 'failed', _input: inTok, _output: outTok, _reason: g.code });
        send({ type: 'error', code: g.code, status: g.status, message: g.message });
      } finally {
        clearInterval(heartbeat);
        if (!closed) { closed = true; try { ctrl.close(); } catch { /* closed */ } }
      }
    },
    cancel() { closed = true; ac.abort(); },
  });
  return new Response(stream, { headers: { ...corsHeaders(req), 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
});
