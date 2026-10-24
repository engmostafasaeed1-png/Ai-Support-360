// The browser's built-in recogniser, used when server transcription is not available. It restarts itself after the
// browser ends recognition on a short pause, so a thinking pause no longer ends the answer.
import { classifyWebSpeechError, type MicProblem } from './micErrors';

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};

function ctor(): (new () => Rec) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as (new () => Rec) | null;
}

export function hasWebSpeech(): boolean { return !!ctor(); }

/** Interview / picker language to a browser recognition language. */
export function toSpeechLang(lang: string | null | undefined): string {
  const l = String(lang || '').trim();
  const map: Record<string, string> = { en: 'en-US', ar: 'ar-EG', 'ar-SA': 'ar-SA', fr: 'fr-FR', es: 'es-ES', de: 'de-DE' };
  if (map[l]) return map[l];
  if (/^[a-z]{2}-[A-Z]{2}$/.test(l)) return l;
  if (l === 'auto' && typeof navigator !== 'undefined' && /^ar/i.test(navigator.language)) return 'ar-EG';
  return 'en-US';
}

export interface WebSpeechHandle { stop: () => void }

export function startWebSpeech(o: {
  lang: string;
  onFinal: (chunk: string) => void;
  onInterim: (text: string) => void;
  onProblem: (p: MicProblem | 'network') => void;
}): WebSpeechHandle | null {
  const C = ctor();
  if (!C) return null;
  let active = true;
  let restarts = 0;
  let rec: Rec;
  const make = () => {
    rec = new C();
    rec.lang = toSpeechLang(o.lang);
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
      }
      if (final.trim()) o.onFinal(final.trim());
      o.onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      const p = classifyWebSpeechError(e.error);
      if (p === 'no-speech' || p === 'aborted') return; // restarted by onend
      if (p === 'permission' || p === 'device' || p === 'unsupported') active = false;
      o.onProblem(p);
    };
    rec.onend = () => {
      if (!active) return;
      if (++restarts > 200) { active = false; return; }
      setTimeout(() => { if (active) { try { make(); rec.start(); } catch { active = false; } } }, 120);
    };
  };
  make();
  try { rec!.start(); } catch { return null; }
  return {
    stop() {
      active = false;
      try { rec.stop(); } catch { /* already stopped */ }
    },
  };
}
