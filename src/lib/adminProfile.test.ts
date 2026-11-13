import { describe, expect, it } from 'vitest';
import { profileRoles, profilePageUrl } from './adminProfile';
describe('admin profile routing', () => {
  it('preserves every supported role for multi-role tabs', () => {
    expect(profileRoles(['client','consultant','admin','client','super_admin','unknown'])).toEqual(['client','consultant','admin','super_admin']);
  });
  it('routes by account ID when both IDs are known', () => {
    expect(profilePageUrl({userId:'u1',consultantId:'c1'})).toBe('/admin/users?profilePage=1&fullUser=u1');
  });
  it('passes consultant IDs explicitly rather than treating them as account IDs', () => {
    expect(profilePageUrl({consultantId:'c1'})).toBe('/admin/users?profilePage=1&fullConsultant=c1');
  });
});