import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc, storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://files.example/test.pdf' }, error: null }) }) } } }));
vi.mock('@/hooks/useProfileFieldRules', () => ({ useProfileFieldRules: () => ({ labels: new Map([['bio', 'Biography']]) }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
import ConsultantFullProfileSheet, { ConsultantFullProfileBody } from './ConsultantFullProfileSheet';
const full = {
  consultant: { verification_status: 'verified', rating: 4.5, total_reviews: 12, bio: '<b>Stored biography</b>', linkedin_url: 'https://www.linkedin.com/in/sara', availability_status: 'available', sap_role: 'Functional', total_sap_years: 10, ai_skills_score: 80 },
  account: { email: 'sara@example.test', provider: 'google' }, profile: { display_name: 'Sara' }, private: {},
  counts: { tickets_assigned: 3, bids: 4, ndas_signed: 2 }, missing_required_fields: ['bio'],
  skills: [{ id:'s',sap_module:'FI',proficiency_level:4,years_experience:10,certified:true }], certifications: [{ name:'SAP certificate', verified:true }],
  work_history: [{company_name:'Example company',job_title:'Consultant'}], education:[{institution:'Example university'}], projects:[{project_name:'Migration'}],
  availability: [{day_of_week:1,start_time:'09:00',end_time:'17:00',is_recurring:true}], interviews:[{interview_type:'ai',overall_score:85,ai_summary:'Useful evaluation'}],
  payout: {account_holder:'Sara',bank_name:'Example bank',iban:'GB82WEST12345698765432',account_number:'123456789012',swift_bic:'EXAMPLE12345',acknowledged_at:'2026-10-01',verified_at:'2026-10-02'},
};
function select(name: string) { const tab=screen.getByRole('tab',{name}); fireEvent.mouseDown(tab);fireEvent.click(tab); }
function show(data: unknown = full) {
  rpc.mockResolvedValue({data,error:null});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  return render(<QueryClientProvider client={client}><ConsultantFullProfileSheet consultantId="c1" onClose={vi.fn()} /></QueryClientProvider>);
}
beforeEach(() => rpc.mockReset());
afterEach(() => {cleanup();vi.useRealTimers();});
describe('consultant full profile sheet', () => {
  it('loads the audited RPC and presents all six tabs with full records', async () => {
    show();await screen.findByRole('tab',{name:'Overview'});
    expect(rpc).toHaveBeenCalledWith('admin_consultant_full_profile',{_cid:'c1'});
    for(const name of ['Overview','Personal & links','Experience','Records','Interviews','Payout']) expect(screen.getByRole('tab',{name})).toBeInTheDocument();
    expect(screen.getByText('Biography')).toBeInTheDocument();
    select('Records');expect(screen.getByText('Example company')).toBeInTheDocument();expect(screen.getByText('Example university')).toBeInTheDocument();
    select('Interviews');expect(screen.getByText('Useful evaluation')).toBeInTheDocument();
  });
  it('handles an almost empty object in every tab without crashing', async () => {
    show({consultant:{},profile:null,payout:null});await screen.findByRole('tab',{name:'Overview'});
    for(const name of ['Overview','Personal & links','Experience','Records','Interviews','Payout']) {select(name);expect(screen.getAllByText('Not provided').length).toBeGreaterThan(0);}
  });
  it('opens safe outbound links with noopener and renders biography as text', async () => {
    show();await screen.findByRole('tab',{name:'Overview'});select('Personal & links');
    const link=screen.getByRole('link',{name:'https://www.linkedin.com/in/sara'});
    expect(link).toHaveAttribute('rel','noopener noreferrer');expect(link).toHaveAttribute('target','_blank');
    expect(screen.getByText('<b>Stored biography</b>').querySelector('b')).toBeNull();
  });
  it('masks bank identifiers until Show and remasks after 30 seconds', () => {
    vi.useFakeTimers();render(<ConsultantFullProfileBody data={full} />);select('Payout');
    expect(screen.queryByText(full.payout.iban)).toBeNull();expect(screen.queryByText(full.payout.account_number)).toBeNull();expect(screen.queryByText(full.payout.swift_bic)).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Show'}));
    expect(screen.getByText(full.payout.iban)).toBeInTheDocument();expect(screen.getByText(full.payout.account_number)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(29999));expect(screen.getByText(full.payout.iban)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));expect(screen.queryByText(full.payout.iban)).toBeNull();expect(screen.queryByText(full.payout.swift_bic)).toBeNull();
  });
  it('remasks immediately when leaving payout', () => {
    render(<ConsultantFullProfileBody data={full} />);select('Payout');fireEvent.click(screen.getByRole('button',{name:'Show'}));select('Overview');select('Payout');expect(screen.queryByText(full.payout.iban)).toBeNull();
  });
  it('shows the database error message in an alert', async () => {
    rpc.mockResolvedValue({data:null,error:{message:'Administrators only'}});
    const client=new QueryClient();render(<QueryClientProvider client={client}><ConsultantFullProfileSheet consultantId="c1" onClose={vi.fn()} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Administrators only'));
  });
});