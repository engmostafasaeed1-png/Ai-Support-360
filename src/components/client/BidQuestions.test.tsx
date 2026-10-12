import { vi, describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ answer: vi.fn(), hide: vi.fn() }));
vi.mock('@/hooks/useClientBids', () => ({ useAnswerQuestion: () => ({ mutate: mocks.answer }), useHideQuestion: () => ({ mutate: mocks.hide }) }));
import BidQuestions from './BidQuestions';
const q = { id: 'q', ticket_id: 't', question: 'Which system version?', answer: null, answered_at: null, hidden: false, created_at: '2026-10-12T10:00:00Z' };
describe('client question actions', () => {
  it('submits the answer for the correct question and hides it', () => { render(<BidQuestions questions={[q]} />); fireEvent.change(screen.getByRole('textbox', { name: 'Answer' }), { target: { value: 'S/4HANA' } }); fireEvent.click(screen.getByRole('button', { name: 'Answer' })); expect(mocks.answer.mock.calls[0][0]).toEqual({ id: 'q', answer: 'S/4HANA' }); fireEvent.click(screen.getByRole('button', { name: 'Hide' })); expect(mocks.hide.mock.calls[0][0]).toEqual({ id: 'q', hidden: true }); });
  it('shows a hidden answered question again', () => { render(<BidQuestions questions={[{ ...q, hidden: true, answer: 'S/4HANA' }]} />); fireEvent.click(screen.getByRole('button', { name: 'Show' })); expect(mocks.hide.mock.calls.at(-1)?.[0]).toEqual({ id: 'q', hidden: false }); });
});
