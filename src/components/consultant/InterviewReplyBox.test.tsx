import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useInterviewAutoSend } from '@/hooks/useInterviewAutoSend';
import InterviewReplyBox from './InterviewReplyBox';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const setup = () => { const send = vi.fn(); render(<InterviewReplyBox value="I configured SAP" busy={false} listening={false} voiceSupported={false} onChange={vi.fn()} onSend={send} onVoice={vi.fn()} />); return send; };
describe('natural interview send', () => {
  it('Enter sends once', () => { const send = setup(); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); expect(send).toHaveBeenCalledTimes(1); });
  it('Shift+Enter keeps a new line', () => { const send = setup(); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true }); expect(send).not.toHaveBeenCalled(); });
  it('Send answer sends once', () => { const send = setup(); fireEvent.click(screen.getByRole('button', { name: 'interview.send_answer' })); expect(send).toHaveBeenCalledTimes(1); });
  it('Ctrl+Enter sends once', () => { const send = setup(); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true }); expect(send).toHaveBeenCalledTimes(1); });
  it('clicking or pressing a key during speech countdown cancels temporarily, not sticky pause', () => {
    const pause = vi.fn(), cancel = vi.fn(); render(<InterviewReplyBox value="I configured SAP" busy={false} remaining={2000} countdownSource="speech" onPause={pause} onCancelCountdown={cancel} listening={false} voiceSupported={false} onChange={vi.fn()} onSend={vi.fn()} onVoice={vi.fn()} />);
    fireEvent.click(screen.getByRole('textbox')); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'a' }); expect(cancel).toHaveBeenCalledTimes(2); expect(pause).not.toHaveBeenCalled();
  });
});

describe('reply box with the real auto-send controller', () => {
  afterEach(() => vi.useRealTimers());
  function Harness({ send, blocked = false }: { send: () => void; blocked?: boolean }) {
    const [text, setText] = useState('');
    const auto = useInterviewAutoSend({ text, blocked, onSend: send });
    return <><output data-testid="paused">{String(auto.paused)}</output><output data-testid="remaining">{auto.remaining}</output><InterviewReplyBox value={text} busy={blocked} listening={false} voiceSupported={false} paused={auto.paused} remaining={auto.remaining} countdownSource={auto.source} onPause={() => auto.pause()} onCancelCountdown={() => auto.pause(false)} onChange={value => { setText(value); auto.arm('typing'); }} onSend={send} onVoice={vi.fn()} /></>;
  }
  it('three consecutive typed characters restart four seconds without pausing, then a valid answer sends once', () => {
    vi.useFakeTimers(); const send = vi.fn(); render(<Harness send={send} />);
    const box = screen.getByRole('textbox'); fireEvent.click(box);
    let value = '';
    for (const key of ['S', 'A', 'P']) {
      fireEvent.keyDown(box, { key }); value += key; fireEvent.change(box, { target: { value } });
      expect(screen.getByTestId('paused').textContent).toBe('false'); expect(screen.getByTestId('remaining').textContent).toBe('4000');
      act(() => vi.advanceTimersByTime(1000));
    }
    fireEvent.change(box, { target: { value: 'SAP configuration experience' } });
    act(() => vi.advanceTimersByTime(3950)); expect(send).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(50)); expect(send).toHaveBeenCalledTimes(1);
  });
  it('text typed during streaming sends after streaming ends', () => {
    vi.useFakeTimers(); const send = vi.fn(); const view = render(<Harness send={send} blocked />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'I configured SAP' } }); act(() => vi.advanceTimersByTime(5000)); expect(send).not.toHaveBeenCalled();
    view.rerender(<Harness send={send} blocked={false} />); act(() => vi.advanceTimersByTime(4000)); expect(send).toHaveBeenCalledTimes(1);
  });
  it('explicit Pause/Edit stays paused through more typing and the end of streaming', () => {
    vi.useFakeTimers(); const send = vi.fn(); const view = render(<Harness send={send} blocked />);
    fireEvent.click(screen.getByRole('button', { name: 'interview.pause_edit' })); fireEvent.click(screen.getByRole('textbox'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'I configured SAP' } }); view.rerender(<Harness send={send} blocked={false} />);
    act(() => vi.advanceTimersByTime(8000)); expect(screen.getByTestId('paused').textContent).toBe('true'); expect(send).not.toHaveBeenCalled();
  });
});