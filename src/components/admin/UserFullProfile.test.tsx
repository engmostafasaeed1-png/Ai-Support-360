import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/safeRpc',()=>({safeRpc:rpc,isMissingRpc:(e:{code:string})=>e.code==='PGRST202'}));
vi.mock('./ConsultantFullProfileSheet',()=>({ConsultantFullProfileBody:({data}:{data:Record<string,unknown>})=><div>{String(data.marker)}</div>,ProfileDecisionBar:()=>null}));
vi.mock('./DecisionEmailNotice',()=>({default:()=>null}));
vi.mock('./users/DirectEmailDialog',()=>({default:()=>null}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(_k:string,f?:string)=>f??_k,i18n:{dir:()=> 'ltr'}})}));
import { AdminProfileHost, UserFullProfileBody } from './UserFullProfile';
afterEach(()=>{cleanup();rpc.mockReset();});
const data={roles:['client','consultant','admin'],account:{user_id:'u1',email:'test@example.test'},consultant:{marker:'Existing consultant viewer'},client:{company:{company_name:'Company example'},ratings_received:[{score:4,comment:'Clear requirements'}]}};
describe('generic admin full profile',()=>{
  it('loads one audited generic RPC with the account ID',async()=>{
    rpc.mockResolvedValue({data,error:null});
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/admin/users?fullUser=u1']}><AdminProfileHost/></MemoryRouter></QueryClientProvider>);
    await waitFor(()=>expect(rpc).toHaveBeenCalledWith('admin_user_full_profile',{_uid:'u1',_cid:null}));
    expect(await screen.findByText('Existing consultant viewer')).toBeInTheDocument();
  });
  it('fails closed when the SQL is not installed',async()=>{
    rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'Not installed'}});
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/admin/users?fullConsultant=c1']}><AdminProfileHost/></MemoryRouter></QueryClientProvider>);
    await screen.findByRole('alert');
    expect(rpc).toHaveBeenCalledWith('admin_user_full_profile',{_uid:null,_cid:'c1'});
    expect(screen.queryByText('Existing consultant viewer')).toBeNull();
  });
  it('includes consultant ratings of the client in the client role view',()=>{
    render(<UserFullProfileBody data={data} onChanged={()=>{}}/>);
    const tab=screen.getByRole('tab',{name:'client'});fireEvent.mouseDown(tab);fireEvent.click(tab);
    expect(screen.getByText('Clear requirements')).toBeInTheDocument();
  });
});