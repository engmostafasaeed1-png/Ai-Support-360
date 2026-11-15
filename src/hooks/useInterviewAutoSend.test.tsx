import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInterviewAutoSend } from './useInterviewAutoSend';
import { SPEECH_SILENCE_MS, TYPING_IDLE_MS, HEARING_WARNING_MS } from '@/lib/interviewConversation';
describe('hands-free answer rules', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const setup = (text = 'I configured SAP') => { const send = vi.fn(); const hook = renderHook(({ blocked }) => useInterviewAutoSend({ text, blocked, onSend: send }), { initialProps: { blocked: false } }); return { ...hook, send }; };
  it('sends speech once after exactly 2.5 seconds of silence', () => { expect(SPEECH_SILENCE_MS).toBe(2500); const h = setup(); act(() => h.result.current.arm('speech')); act(() => vi.advanceTimersByTime(2450)); expect(h.send).not.toHaveBeenCalled(); act(() => vi.advanceTimersByTime(50)); expect(h.send).toHaveBeenCalledTimes(1); act(() => vi.advanceTimersByTime(5000)); expect(h.send).toHaveBeenCalledTimes(1); });
  it('sends typing only after 4 seconds idle', () => { expect(TYPING_IDLE_MS).toBe(4000); const h = setup(); act(() => h.result.current.arm('typing')); act(() => vi.advanceTimersByTime(3950)); expect(h.send).not.toHaveBeenCalled(); act(() => vi.advanceTimersByTime(50)); expect(h.send).toHaveBeenCalledTimes(1); });
  it('new speech cancels and restarts the countdown', () => { const h = setup(); act(() => h.result.current.arm('speech')); act(() => vi.advanceTimersByTime(2000)); act(() => { h.result.current.cancel(); h.result.current.arm('speech'); }); act(() => vi.advanceTimersByTime(2000)); expect(h.send).not.toHaveBeenCalled(); act(() => vi.advanceTimersByTime(500)); expect(h.send).toHaveBeenCalledTimes(1); });
  it('paused editing never sends even if activity continues', () => { const h = setup(); act(() => { h.result.current.arm('speech'); h.result.current.pause(); }); act(() => h.result.current.arm('typing')); act(() => vi.advanceTimersByTime(10000)); expect(h.result.current.paused).toBe(true); expect(h.send).not.toHaveBeenCalled(); });
  it('never sends fewer than 3 words', () => { const h = setup('SAP consultant'); act(() => h.result.current.arm('speech')); act(() => vi.advanceTimersByTime(10000)); expect(h.send).not.toHaveBeenCalled(); });
  it('AI playback or errors cancel queued sending', () => { const h = setup(); act(() => h.result.current.arm('speech')); h.rerender({ blocked: true }); act(() => vi.advanceTimersByTime(10000)); expect(h.send).not.toHaveBeenCalled(); });
  it('hearing warning threshold is 8 seconds', () => expect(HEARING_WARNING_MS).toBe(8000));
});