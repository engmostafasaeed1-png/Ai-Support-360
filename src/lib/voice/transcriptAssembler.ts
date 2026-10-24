// Keeps transcribed segments in spoken order even when the server answers out of order. Pure (unit-tested).

export type SlotState = 'pending' | 'done' | 'failed';
interface Slot { state: SlotState; text: string; raw: string }

/** Joins text pieces with single spaces (Arabic and English alike), dropping empty ones. */
export function joinText(...parts: Array<string | null | undefined>): string {
  return parts.map((p) => String(p ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
}

export class TranscriptAssembler {
  private slots: Slot[] = [];

  /** Reserves the next position; returns its index. */
  open(): number {
    this.slots.push({ state: 'pending', text: '', raw: '' });
    return this.slots.length - 1;
  }

  resolve(index: number, text: string, raw = text): void {
    const s = this.slots[index];
    if (!s || s.state !== 'pending') return;
    s.state = 'done';
    s.text = text;
    s.raw = raw;
  }

  fail(index: number): void {
    const s = this.slots[index];
    if (s && s.state === 'pending') s.state = 'failed';
  }

  /** Text so far, in spoken order (later pieces show as soon as they arrive). */
  get text(): string {
    return joinText(...this.slots.filter((s) => s.state === 'done').map((s) => s.text));
  }

  get rawText(): string {
    return joinText(...this.slots.filter((s) => s.state === 'done').map((s) => s.raw));
  }

  get pending(): number {
    return this.slots.filter((s) => s.state === 'pending').length;
  }

  get failed(): number {
    return this.slots.filter((s) => s.state === 'failed').length;
  }

  get size(): number {
    return this.slots.length;
  }

  reset(): void {
    this.slots = [];
  }
}
