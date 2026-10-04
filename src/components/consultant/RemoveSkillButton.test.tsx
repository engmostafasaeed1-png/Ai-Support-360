import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ from: vi.fn(), selectDeleted: vi.fn(), eq: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      mocks.from(table);
      return {
        delete: () => ({
          eq: (column: string, value: string) => {
            mocks.eq(column, value);
            return { select: mocks.selectDeleted };
          },
        }),
      };
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import RemoveSkillButton from './RemoveSkillButton';

const SKILL = { id: 's-1', module: 'SAP FI' };

const openDialog = () => fireEvent.click(screen.getByRole('button', { name: 'Remove skill SAP FI' }));
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

beforeEach(() => {
  mocks.from.mockReset();
  mocks.eq.mockReset();
  mocks.selectDeleted.mockReset();
  mocks.selectDeleted.mockResolvedValue({ data: [{ id: 's-1' }], error: null });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(() => cleanup());

describe('RemoveSkillButton', () => {
  it('asks first and removes nothing before the consultant confirms', () => {
    render(<RemoveSkillButton skill={SKILL} />);
    openDialog();
    expect(screen.getByText('Remove this skill?')).toBeTruthy();
    expect(mocks.eq).not.toHaveBeenCalled();
  });

  it('removes the skill, says so and tells the page', async () => {
    const onRemoved = vi.fn();
    render(<RemoveSkillButton skill={SKILL} onRemoved={onRemoved} />);
    openDialog();
    confirm();
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(mocks.from).toHaveBeenCalledWith('consultant_skills');
    expect(mocks.eq).toHaveBeenCalledWith('id', 's-1');
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('reports a problem when nothing was removed', async () => {
    mocks.selectDeleted.mockResolvedValue({ data: [], error: null });
    const onRemoved = vi.fn();
    render(<RemoveSkillButton skill={SKILL} onRemoved={onRemoved} />);
    openDialog();
    confirm();
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('reports a problem when the database gives an error', async () => {
    mocks.selectDeleted.mockResolvedValue({ data: null, error: { message: 'denied' } });
    const onRemoved = vi.fn();
    render(<RemoveSkillButton skill={SKILL} onRemoved={onRemoved} />);
    openDialog();
    confirm();
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('has a clear name for a skill without a module', () => {
    render(<RemoveSkillButton skill={{ id: 's-2', module: '' }} />);
    expect(screen.getByRole('button', { name: 'Remove skill this empty skill' })).toBeTruthy();
  });
});
