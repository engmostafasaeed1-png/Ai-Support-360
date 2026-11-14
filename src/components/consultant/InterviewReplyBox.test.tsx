import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InterviewReplyBox from './InterviewReplyBox';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const setup = () => { const send = vi.fn(); render(<InterviewReplyBox value="SAP answer" busy={false} listening={false} voiceSupported={false} onChange={vi.fn()} onSend={send} onVoice={vi.fn()} />); return send; };
describe('explicit interview send', () => {
  it('Enter does not send', () => { const send = setup(); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); expect(send).not.toHaveBeenCalled(); });
  it('Send answer sends once', () => { const send = setup(); fireEvent.click(screen.getByRole('button', { name: 'interview.send_answer' })); expect(send).toHaveBeenCalledTimes(1); });
  it('Ctrl+Enter sends once', () => { const send = setup(); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true }); expect(send).toHaveBeenCalledTimes(1); });
});