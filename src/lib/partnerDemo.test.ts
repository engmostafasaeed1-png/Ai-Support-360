import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { DEMO_RESOURCES, demoInvite, demoSetAvailability } from './partnerDemo';

describe('partner demo data', () => {
  it('is imported only by the partner page, so it never reaches search, matching, AI or admin statistics', () => {
    const out = execSync("grep -rl --include=*.ts --include=*.tsx \"partnerDemo'\" src || true").toString().trim().split('\n').filter(Boolean)
      .filter((f) => !f.endsWith('partnerDemo.test.ts'));
    expect(out).toEqual(['src/pages/partner/PartnerPortalPage.tsx']);
  });
  it('labels every sample person and uses no real ids', () => {
    expect(DEMO_RESOURCES).toHaveLength(6);
    for (const r of DEMO_RESOURCES) { expect(r.name).toContain('(sample)'); expect(r.consultant_id.startsWith('demo-')).toBe(true); }
  });
  it('changes only the in-memory copy and reports agreement conflicts', () => {
    const { rows, conflicts } = demoSetAvailability(DEMO_RESOURCES, ['demo-c1'], { capacity: 10 });
    expect(rows.find((r) => r.consultant_id === 'demo-c1')?.capacity_hours_week).toBe(10);
    expect(DEMO_RESOURCES[0].capacity_hours_week).toBe(30);
    expect(conflicts).toHaveLength(1);
    expect(demoInvite(DEMO_RESOURCES, 'x@y.com')).toHaveLength(7);
  });
});
