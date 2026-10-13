import { describe, it, expect, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));

import { fetchHiddenConsultantIds, withoutHidden } from './useHiddenConsultants';

const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('directory hiding', () => {
  it('removes the hidden ids', async () => {
    rpc.mockResolvedValueOnce({ data: ['b'], error: null });
    const hidden = await fetchHiddenConsultantIds();
    expect(withoutHidden(list, hidden).map(c => c.id)).toEqual(['a', 'c']);
  });

  it('shows everyone when the call fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(withoutHidden(list, await fetchHiddenConsultantIds())).toHaveLength(3);
    rpc.mockRejectedValueOnce(new Error('network'));
    expect(withoutHidden(list, await fetchHiddenConsultantIds())).toHaveLength(3);
  });
});
