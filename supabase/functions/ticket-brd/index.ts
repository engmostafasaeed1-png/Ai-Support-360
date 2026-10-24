// Business Requirements Document (BRD) from a ticket: AI drafting and section rewrites, plus the e-mail part of
// "notify the consultant when I attach a new version".
//
// Security
// - Signed-in callers only (JWT checked in code). Every AI call first claims a slot with the service-only
//   brd_ai_claim RPC, which re-checks the caller is the ticket's client or an admin (feature switch, closed ticket),
//   enforces the per-ticket / per-client / deep-analysis limits under a lock and logs model + tokens.
// - The ticket is read here with the service role only after that check; ticket text and attachment text are
//   untrusted data (brdPrompt.wrapTicketData); the reply is schema-validated, turned into escaped HTML, scrubbed of
//   secrets and contact details (brdSafety). Nothing is saved here: the browser shows it for review, and the save
//   RPCs check and mask everything again.
// - Long calls stream from the gateway; the browser gets NDJSON progress lines and one final line, and its Stop
//   cancels the upstream call. Gateway errors are terminal for the request (no automatic retries).

import { z } from 'https://esm.sh/zod@3.23.8';
import { adminClient, authenticateUser, corsHeaders, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';
import { extractFirstFunctionCall, responsesRequest, userTextItem } from '../_shared/aiResponses.ts';
import {
  BrdOutputError, DRAFT_TOOL, SECTION_TOOL, draftInstructions, parseDraft, parseSection, sectionInstructions, wrapTicketData,
} from '../_shared/brdPrompt.ts';
import {
  AI_SECTION_KEYS, BRD_LANGUAGES, BRD_TEMPLATES, LIMITS, TEMPLATE_SECTIONS, emptyContent, normalizeContent, renumberRequirements, ticketRef,
  type BrdContent, type SectionKey,
} from '../_shared/brdModel.ts';
import { cleanContent, cleanText } from '../_shared/brdSafety.ts';
import { INCLUDE_KEYS, buildTicketParts } from '../_shared/brdTicketParts.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

const includeSchema = z.object(Object.fromEntries(INCLUDE_KEYS.map((k) => [k, z.boolean().optional()]))).partial().default({});
const attachmentsSchema = z.array(z.object({ name: z.string().max(200), text: z.string().max(40_000) })).max(10).default([]);

const DraftBody = z.object({
  action: z.literal('draft'),
  ticketId: z.string().uuid(),
  language: z.enum(BRD_LANGUAGES as [string, ...string[]]),
  template: z.enum(BRD_TEMPLATES as [string, ...string[]]),
  include: includeSchema,
  attachments: attachmentsSchema,
  clientAnswers: z.array(z.object({ question: z.string().max(300), answer: z.string().max(1000) })).max(8).default([]),
  deep: z.boolean().default(false),
});
const SectionBody = z.object({
  action: z.literal('section'),
  ticketId: z.string().uuid(),
  language: z.enum(BRD_LANGUAGES as [string, ...string[]]),
  section: z.enum(AI_SECTION_KEYS as [string, ...string[]]),
  mode: z.enum(['regenerate', 'improve', 'shorter']),
  currentHtml: z.string().max(LIMITS.sectionChars * 2).default(''),
  currentHtmlAr: z.string().max(LIMITS.sectionChars * 2).default(''),
  include: includeSchema,
  attachments: attachmentsSchema,
  deep: z.boolean().default(false),
});
const NotifyBody = z.object({ action: z.literal('notify'), documentId: z.string().uuid() });
const Body = z.discriminatedUnion('action', [DraftBody, SectionBody, NotifyBody]);

type GatewayFailure = { code: string; status: number; message: string };

function gatewayFailure(status: number, upstreamMessage: string): GatewayFailure {
  if (status === 402) return { code: 'credits', status, message: upstreamMessage || 'The AI credits for this workspace have run out. Please try again later.' };
  if (status === 429) return { code: 'busy', status, message: 'The AI service is busy right now. Please wait a minute and try again.' };
  if (status === 403) return { code: 'denied', status, message: upstreamMessage || 'The AI service declined this request.' };
  if (status === 400) return { code: 'bad_request', status, message: 'The AI could not process this ticket. You can write the document yourself.' };
  return { code: 'unavailable', status, message: 'The AI service is not available right now. Please try again later.' };
}

/** Reads a Responses SSE stream to the final response object. Calls tick() on every event (keeps the browser informed). */
async function readResponsesStream(res: Response, tick: () => void): Promise<Record<string, unknown>> {
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
      if (ev.type === 'response.completed' && ev.response) final = ev.response;
      else if (ev.type === 'response.incomplete' && ev.response) final = ev.response;
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
  try {
    const j = await res.json();
    const m = j?.error?.message ?? j?.message;
    return typeof m === 'string' ? m.slice(0, 300) : '';
  } catch { return ''; }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const user = await authenticateUser(req);
  if (!user) return jsonResponse(req, { error: 'Please sign in again.' }, 401);

  let raw: unknown;
  try { raw = await req.json(); } catch { return jsonResponse(req, { error: 'Invalid request' }, 400); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonResponse(req, { error: 'Invalid request', details: parsed.error.flatten().fieldErrors }, 400);
  const body = parsed.data;
  const admin = adminClient();

  // ------------------------------------------------------------------ notify (e-mail part)
  if (body.action === 'notify') {
    const { data: rows, error } = await admin.rpc('brd_claim_notices', { _document_id: body.documentId, _caller: user.id });
    if (error) return jsonResponse(req, { error: 'Could not send the e-mails.' }, 500);
    let sent = 0, skipped = 0;
    for (const r of (rows ?? []) as Array<{ user_id: string; version: number; ticket_id: string; ticket_title: string | null }>) {
      try {
        const { data: u } = await admin.auth.admin.getUserById(r.user_id);
        const email = u?.user?.email;
        if (!email) { skipped++; continue; }
        const { data: prof } = await admin.from('profiles').select('preferred_language').eq('user_id', r.user_id).maybeSingle();
        const res = await sendTemplateEmail('brd-attached', email, {
          templateData: {
            lang: prof?.preferred_language === 'ar' ? 'ar' : 'en', version: r.version, ticketTitle: r.ticket_title ?? '',
            url: `${SITE_URL}/consultant/cases/${r.ticket_id}/brd`,
          },
          idempotencyKey: `brd-attached:${body.documentId}:${r.user_id}`,
          pause: { userId: r.user_id, category: 'activity' },
        });
        if (res.sent) sent++; else skipped++;
      } catch {
        skipped++;
      }
    }
    return jsonResponse(req, { sent, skipped });
  }

  // ------------------------------------------------------------------ AI actions
  const deep = body.deep === true;
  const kind = body.action === 'draft' ? (deep ? 'deep_draft' : 'draft')
    : deep ? 'deep_section' : body.mode === 'regenerate' ? 'section' : body.mode;
  const { data: claim, error: claimError } = await admin.rpc('brd_ai_claim', { _ticket: body.ticketId, _actor: user.id, _kind: kind });
  if (claimError) return jsonResponse(req, { error: 'The document assistant is not available yet.' }, 503);
  const c = (claim ?? {}) as { ok?: boolean; reason?: string; id?: string; model?: string; max_attachments?: number; max_attachment_chars?: number };
  if (!c.ok) {
    const status = c.reason === 'not_allowed' ? 403 : 429;
    return jsonResponse(req, { error: c.reason ?? 'not_allowed', code: c.reason ?? 'not_allowed' }, status);
  }
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey || !c.model || !c.id) {
    await admin.rpc('brd_ai_finish', { _id: c.id, _status: 'failed', _input: 0, _output: 0, _reason: 'configuration' });
    return jsonResponse(req, { error: 'The document assistant is not configured.' }, 500);
  }
  const usageId = c.id;
  const model = c.model;

  const [{ data: ticket }, { data: answers }] = await Promise.all([
    admin.from('tickets').select('id, title, description, sap_module, sap_modules, sap_module_other, area_details, sap_notes_tried, urgency, critical_response, ticket_context, created_at, client_id')
      .eq('id', body.ticketId).maybeSingle(),
    admin.from('assignment_info_requests').select('question, answer').eq('ticket_id', body.ticketId).not('answer', 'is', null).order('answered_at', { ascending: true }).limit(10),
  ]);
  if (!ticket) {
    await admin.rpc('brd_ai_finish', { _id: usageId, _status: 'failed', _input: 0, _output: 0, _reason: 'ticket_missing' });
    return jsonResponse(req, { error: 'Ticket not found' }, 404);
  }

  const parts = buildTicketParts({
    ticket, include: body.include, answers: answers ?? [], attachments: body.attachments,
    clientAnswers: body.action === 'draft' ? body.clientAnswers : [],
    maxAttachments: c.max_attachments ?? 3, maxAttachmentChars: c.max_attachment_chars ?? 6000,
  });
  if (body.action === 'section') {
    const current = [body.currentHtml, body.currentHtmlAr].filter(Boolean).join('\n\n---\n\n');
    parts.push({ name: 'current_text', text: current.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
  }
  const data = wrapTicketData(parts);
  const language = body.language as BrdContent['language'];
  const template = body.action === 'draft' ? (body.template as BrdContent['template']) : 'standard';
  const instructions = body.action === 'draft'
    ? draftInstructions({ language, template, sections: TEMPLATE_SECTIONS[template].filter((k) => k !== 'change_log') as SectionKey[], deep })
    : sectionInstructions({ language, section: body.section as SectionKey, mode: body.mode, deep });

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
          apiKey, model, instructions, input: [userTextItem(data.block || '<ticket_data></ticket_data>')],
          tools: [body.action === 'draft' ? DRAFT_TOOL : SECTION_TOOL],
          toolChoice: { type: 'function', name: body.action === 'draft' ? 'write_brd' : 'write_section' },
          stream: true, effort: deep ? 'medium' : 'low', signal: ac.signal,
        });
        if (!res.ok || !res.body) throw Object.assign(new Error('upstream'), { gateway: gatewayFailure(res.status, await upstreamMessage(res)) });
        send({ type: 'progress', step: 'writing' });
        const final = await readResponsesStream(res, tick);
        const usage = (final.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
        inTok = usage.input_tokens ?? 0; outTok = usage.output_tokens ?? 0;
        const call = extractFirstFunctionCall(final);
        if (!call) throw Object.assign(new Error('no_call'), { gateway: { code: 'no_answer', status: 502, message: 'The AI did not return a document this time. You can write it yourself or try again later.' } });
        send({ type: 'progress', step: 'checking' });

        if (body.action === 'draft') {
          const d = parseDraft(call.arguments, language);
          const [{ data: cp }, { data: prof }] = await Promise.all([
            admin.from('client_profiles').select('company_name').eq('user_id', ticket.client_id).maybeSingle(),
            admin.from('profiles').select('display_name').eq('user_id', ticket.client_id).maybeSingle(),
          ]);
          const base = emptyContent({
            language, template, title: d.title || ticket.title, ticketRef: ticketRef(ticket.id),
            company: cp?.company_name ?? '', requester: prof?.display_name ?? '',
          });
          base.sections = base.sections.map((s) => {
            const got = d.sections[s.key];
            return got ? { ...s, html: got.html, ...(language === 'both' ? { html_ar: got.html_ar ?? '' } : {}) } : s;
          });
          base.requirements = renumberRequirements(d.requirements.map((r) => ({
            id: '', description: r.description, ...(language === 'both' ? { description_ar: r.description_ar ?? '' } : {}),
            priority: r.priority, status: 'proposed', owner: '', acceptance: r.acceptance,
            ...(language === 'both' ? { acceptance_ar: r.acceptance_ar ?? '' } : {}),
          })));
          base.questions = d.questions.map((q, i) => ({ id: `Q${i + 1}`, question: q.question, options: q.options, answer: '' }));
          const cleaned = cleanContent(normalizeContent(base));
          send({ type: 'result', content: cleaned.content, report: { ...cleaned.report, dropped: data.dropped, truncated: data.truncated } });
        } else {
          const sct = parseSection(call.arguments, language);
          const a = cleanText(sct.html);
          const b = sct.html_ar ? cleanText(sct.html_ar) : null;
          const reqs = sct.requirements?.map((r) => {
            const d1 = cleanText(r.description), a1 = cleanText(r.acceptance);
            return { ...r, description: d1.text, acceptance: a1.text, secrets: d1.secrets + a1.secrets, contacts: d1.contacts + a1.contacts };
          }) ?? null;
          const secrets = a.secrets + (b?.secrets ?? 0) + (reqs ?? []).reduce((n, r) => n + r.secrets, 0);
          const contacts = a.contacts + (b?.contacts ?? 0) + (reqs ?? []).reduce((n, r) => n + r.contacts, 0);
          send({
            type: 'result', html: a.text, html_ar: b?.text,
            requirements: reqs?.map(({ secrets: _s, contacts: _c, ...r }) => r) ?? null,
            report: { secrets, contacts, dropped: data.dropped, truncated: data.truncated },
          });
        }
        await admin.rpc('brd_ai_finish', { _id: usageId, _status: 'ok', _input: inTok, _output: outTok, _reason: null });
      } catch (e) {
        const aborted = ac.signal.aborted;
        const g: GatewayFailure = (e as { gateway?: GatewayFailure }).gateway
          ?? (e instanceof BrdOutputError
            ? { code: 'invalid_output', status: 502, message: 'The AI answer could not be used. You can write it yourself or try again later.' }
            : { code: aborted ? 'stopped' : 'error', status: aborted ? 499 : 500, message: aborted ? 'Stopped.' : 'Something went wrong while drafting.' });
        await admin.rpc('brd_ai_finish', { _id: usageId, _status: 'failed', _input: inTok, _output: outTok, _reason: g.code });
        send({ type: 'error', code: g.code, status: g.status, message: g.message });
      } finally {
        clearInterval(heartbeat);
        if (!closed) { closed = true; try { ctrl.close(); } catch { /* already closed */ } }
      }
    },
    cancel() { closed = true; ac.abort(); },
  });

  return new Response(stream, {
    headers: { ...corsHeaders(req), 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
});
