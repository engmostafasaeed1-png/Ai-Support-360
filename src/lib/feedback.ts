/**
 * Browser side of Feature U (feedback). Separate from the automatic error logger: nothing here is sent unless the
 * person presses Send. Pure rules live in the shared module so the server checks the same things.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  activeEntityFromPath, browserFamily, cleanPath, FEEDBACK_IMAGE_TYPES, FEEDBACK_LIMITS, osFamily, scrubErrorMessage,
  sniffImageType, type FeedbackSeverity, type FeedbackType,
} from '../../supabase/functions/_shared/feedback';

export * from '../../supabase/functions/_shared/feedback';

// ------------------------------------------------------------------ open from anywhere (menus, footer)

export { FEEDBACK_OPEN_EVENT, openFeedback } from './feedbackEvents';

// ------------------------------------------------------------------ last client errors (scrubbed, in memory only)

const recent: string[] = [];
let listening = false;
export function rememberClientError(message: string): void {
  const m = scrubErrorMessage(message);
  if (!m) return;
  if (recent[recent.length - 1] === m) return;
  recent.push(m);
  if (recent.length > FEEDBACK_LIMITS.recentErrors) recent.shift();
}
export function recentClientErrors(): string[] {
  return [...recent];
}
export function listenForClientErrors(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('error', (e) => rememberClientError(e.message || 'Script error'));
  window.addEventListener('unhandledrejection', (e) => {
    const r: any = e.reason;
    rememberClientError(r instanceof Error ? r.message : typeof r === 'string' ? r : 'Unhandled rejection');
  });
}

// ------------------------------------------------------------------ context attached to a report

export interface FeedbackContext {
  path: string;
  route: string;
  version: string;
  lang: string;
  theme: 'dark' | 'light';
  viewport: string;
  browser: string;
  os: string;
  role: string;
  at: string;
  errors: string[];
  entity: { kind: string; id: string } | null;
}

/** Route pattern with ids replaced, e.g. /client/tickets/:id. */
export function routeName(path: string): string {
  return cleanPath(path).replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}(?=\/|$)/gi, '/:id').replace(/\/\d{3,}(?=\/|$)/g, '/:id');
}

export function bundleVersion(): string {
  if (typeof document === 'undefined') return 'unknown';
  const src = Array.from(document.querySelectorAll('script[type="module"][src]'))
    .map((s) => (s as HTMLScriptElement).src).find((s) => /\/assets\//.test(s));
  const m = src?.match(/\/assets\/([^/?#]+)\.js/);
  return m ? m[1].slice(0, 60) : import.meta.env.MODE;
}

export function buildFeedbackContext(role: string, lang: string): FeedbackContext {
  const path = cleanPath(window.location.pathname);
  return {
    path,
    route: routeName(path),
    version: bundleVersion(),
    lang: lang === 'ar' ? 'ar' : 'en',
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    browser: browserFamily(navigator.userAgent),
    os: osFamily(navigator.userAgent),
    role,
    at: new Date().toISOString(),
    errors: recentClientErrors(),
    entity: activeEntityFromPath(path),
  };
}

// ------------------------------------------------------------------ images

/** Re-draws the image on a canvas, which drops EXIF and other metadata (location, camera). Falls back to the original. */
export async function stripImageMetadata(file: File): Promise<File> {
  try {
    const type = (FEEDBACK_IMAGE_TYPES as readonly string[]).includes(file.type) ? file.type : 'image/png';
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, type, 0.9));
    if (!blob || blob.size > FEEDBACK_LIMITS.fileBytes) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : '.jpg'), { type });
  } catch {
    return file;
  }
}

export type ImageProblem = 'type' | 'size' | 'count';
export async function checkImage(file: File): Promise<ImageProblem | null> {
  if (file.size < 1 || file.size > FEEDBACK_LIMITS.fileBytes) return 'size';
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return sniffImageType(head) ? null : 'type';
}

export function canCaptureScreen(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof (navigator.mediaDevices as any).getDisplayMedia === 'function';
}

/** One still frame of the screen the person chooses to share (the browser asks first). */
export async function captureScreen(): Promise<File | null> {
  const stream: MediaStream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 250));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    return blob ? new File([blob], `screen-${Date.now()}.jpg`, { type: 'image/jpeg' }) : null;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

// ------------------------------------------------------------------ submit

export interface FeedbackSubmission {
  type: FeedbackType;
  severity: FeedbackSeverity | null;
  title: string;
  description: string;
  contactEmail: string;
  consentContact: boolean;
  context: FeedbackContext;
  files: File[];
  website: string; // hidden spam trap
  elapsedMs: number;
}

export async function submitFeedback(s: FeedbackSubmission): Promise<{ ok: boolean; error?: string; screenshotsFailed?: number }> {
  const form = new FormData();
  form.append('payload', JSON.stringify({
    type: s.type,
    severity: s.type === 'bug' ? s.severity : null,
    title: s.title.trim(),
    description: s.description.trim(),
    contact_email: s.contactEmail.trim() || null,
    consent_contact: s.consentContact,
    route: s.context.path,
    context: s.context,
    website: s.website,
    elapsed_ms: Math.round(s.elapsedMs),
  }));
  s.files.slice(0, FEEDBACK_LIMITS.files).forEach((f) => form.append('files', f, f.name));
  const { data, error } = await supabase.functions.invoke('feedback', { body: form });
  if (error) {
    let code = 'error';
    try {
      const body = await (error as any).context?.json?.();
      code = body?.error ?? code;
    } catch { /* keep generic */ }
    return { ok: false, error: code };
  }
  return { ok: true, screenshotsFailed: Number((data as any)?.screenshots_failed ?? 0) };
}

// ------------------------------------------------------------------ settings

export async function fetchFeedbackConfig(): Promise<{ enabled: boolean; publicEnabled: boolean }> {
  const { data, error } = await (supabase.rpc as any)('feedback_config');
  // Fail closed until the feedback database file is applied.
  if (error || !data) return { enabled: false, publicEnabled: false };
  return { enabled: data.enabled === true, publicEnabled: data.public_enabled === true };
}
