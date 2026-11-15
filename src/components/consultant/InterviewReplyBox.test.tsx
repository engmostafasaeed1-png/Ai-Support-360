import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InterviewReplyBox from './InterviewReplyBox';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const setup = () => { const send = vi.fn(); render(<InterviewReplyBox value="I configured SAP" busy={false} listening={false} voiceSupported={false} onChange={vi.fn()} onSend={send} onVoice={vi.fn()} />); return send; };
describe('natural interview send', () => {
  it('Enter sends once', () => { const send = setup(); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); expect(send).toHaveBeenCalledTimes(1); });
  it('Shift+Enter keeps a new line', () => { const send = setup(); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true }); expect(send).not.toHaveBeenCalled(); });
  it('Send answer sends once', () => { const send = setup(); fireEvent.click(screen.getByRole('button', { name: 'interview.send_answer' })); expect(send).toHaveBeenCalledTimes(1); });
  it('Ctrl+Enter sends once', () => { const send = setup(); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true }); expect(send).toHaveBeenCalledTimes(1); });
  it('clicking or pressing a key during countdown pauses', () => {
    const pause = vi.fn(); render(<InterviewReplyBox value="I configured SAP" busy={false} remaining={2000} onPause={pause} listening={false} voiceSupported={false} onChange={vi.fn()} onSend={vi.fn()} onVoice={vi.fn()} />);
    fireEvent.click(screen.getByRole('textbox')); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'a' }); expect(pause).toHaveBeenCalledTimes(2);
  });
});