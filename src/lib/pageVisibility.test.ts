import { describe, expect, it } from 'vitest';
import { clientNavGroups } from '@/components/sidebar/navConfig';
import { filterNavGroups, pageAccess } from './pageVisibility';

const paths = (groups: ReturnType<typeof filterNavGroups>) => groups.flatMap((g) => g.items.map((i) => i.path));

describe('Solution Architecture switch', () => {
  it('is hidden from the client menu and search while the switch is off or unknown', () => {
    expect(paths(filterNavGroups(clientNavGroups, {}))).not.toContain('/client/solution-architecture');
    expect(paths(filterNavGroups(clientNavGroups, { solution_architecture_visible: false }))).not.toContain('/client/solution-architecture');
  });
  it('the Delivery group keeps its other items', () => {
    const delivery = filterNavGroups(clientNavGroups, {}).find((g) => g.id === 'delivery')!;
    expect(delivery.items.map((i) => i.key)).toEqual(['projects', 'milestones', 'tasks', 'pm_tickets', 'business_processes']);
  });
  it('comes back when the owner switches it on', () => {
    expect(paths(filterNavGroups(clientNavGroups, { solution_architecture_visible: true }))).toContain('/client/solution-architecture');
  });
  it('the address redirects clients, waits while loading, and stays open for admins', () => {
    expect(pageAccess({ loading: false, visible: false, isAdmin: false })).toBe('redirect');
    expect(pageAccess({ loading: true, visible: false, isAdmin: false })).toBe('wait');
    expect(pageAccess({ loading: false, visible: false, isAdmin: true })).toBe('show');
    expect(pageAccess({ loading: false, visible: true, isAdmin: false })).toBe('show');
  });
});
