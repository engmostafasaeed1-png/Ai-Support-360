import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/safeRpc', () => ({ safeRpc: rpc, isMissingRpc: (e: {code?: string}) => e.code === 'PGRST202' }));
vi.mock('@/components/admin/DecisionEmailNotice', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, fallback?: string) => fallback ?? k }) }));
vi.mock('sonner', () => ({ toast: {success: vi.fn(),error: vi.fn()} }));
import ProfileItemDecision from './ProfileItemDecision';
afterEach(() => {cleanup();rpc.mockReset();});
describe('profile item decisions', () => {
  it('sends certificate needs-changes and comment in one RPC', async () => {
    rpc.mockResolvedValue({data:{ok:true},error:null});
    render(<ProfileItemDecision consultantId="c1" kind="certificate" itemId="s1" label="Certificate" />);
    fireEvent.click(screen.getByRole('button',{name:'Needs changes'}));
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'Please upload the complete certificate.'}});
    fireEvent.click(screen.getByRole('button',{name:'Save decision'}));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('admin_profile_review_item',{_cid:'c1',_kind:'certificate',_item:'s1',_outcome:'changes',_comment:'Please upload the complete certificate.'}));
  });
  it('reuses the existing story moderation RPC', async () => {
    rpc.mockResolvedValue({data:null,error:null});
    render(<ProfileItemDecision consultantId="c1" kind="success_story" itemId="a1" label="Story" />);
    fireEvent.click(screen.getByRole('button',{name:'Approve'}));
    fireEvent.click(screen.getByRole('button',{name:'Save decision'}));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('admin_achievement_review',{_id:'a1',_action:'verify',_reason:''}));
  });
  it('sends an empty approval comment to the shared server default', async () => {
    rpc.mockResolvedValue({data:{ok:true},error:null});
    render(<ProfileItemDecision consultantId="c1" kind="credly" label="Credly" />);
    fireEvent.click(screen.getByRole('button',{name:'Approve'}));
    fireEvent.click(screen.getByRole('button',{name:'Save decision'}));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('admin_profile_review_item',{_cid:'c1',_kind:'credly',_item:null,_outcome:'approved',_comment:''}));
  });
  it('keeps the decision open when the prepared RPC is unavailable', async () => {
    rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'Not installed'}});
    render(<ProfileItemDecision consultantId="c1" kind="linkedin" label="LinkedIn" />);
    fireEvent.click(screen.getByRole('button',{name:'Approve'}));
    fireEvent.click(screen.getByRole('button',{name:'Save decision'}));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});