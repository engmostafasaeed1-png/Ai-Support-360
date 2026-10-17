import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n/config';
import { SidebarProvider } from '@/components/ui/sidebar';
import SidebarNav from './SidebarNav';
import { adminNavGroups, clientNavGroups, consultantNavGroups } from './navConfig';
import { titleize } from './navUtils';
import type { NavGroup, NavItem } from './navTypes';

const labelOf = (item: NavItem) => item.fallback ?? titleize(item.key);
const groupLabelOf = (group: NavGroup) => group.fallback;

/** The account group is closed by default, so a page inside it keeps it open. */
function renderNav(groups: NavGroup[], collapsed = false, activePath = '/consultant/settings') {
  return render(
    <MemoryRouter initialEntries={[activePath]}>
      <SidebarProvider>
        <SidebarNav
          scope="consultant"
          groups={groups}
          activePath={activePath}
          collapsed={collapsed}
          loading={false}
          labelOf={labelOf}
          groupLabelOf={groupLabelOf}
          showSearch={false}
        />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

const NAME = 'Landing page (opens in a new tab)';

describe('landing-page item in the consultant menu', () => {
  it('renders an anchor that opens the public page in a new tab', () => {
    renderNav(consultantNavGroups);
    const link = screen.getByRole('link', { name: NAME });
    expect(link).toHaveAttribute('href', '/for-consultants');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('Landing page');
  });

  it('keeps the same anchor in the collapsed, icon-only menu', () => {
    renderNav(consultantNavGroups, true);
    const link = screen.getByRole('link', { name: NAME });
    expect(link).toHaveAttribute('href', '/for-consultants');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('is never shown as the current page while another item is active', () => {
    renderNav(consultantNavGroups);
    const link = screen.getByRole('link', { name: NAME });
    expect(link).not.toHaveAttribute('aria-current');
    expect(link).toHaveAttribute('data-active', 'false');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });

  it('can be reached from the keyboard', () => {
    renderNav(consultantNavGroups);
    const link = screen.getByRole('link', { name: NAME });
    link.focus();
    expect(document.activeElement).toBe(link);
  });

  it('is not offered to clients or admins', () => {
    renderNav(clientNavGroups, false, '/client/settings');
    expect(screen.queryByRole('link', { name: NAME })).toBeNull();
    renderNav(adminNavGroups, false, '/admin/settings');
    expect(screen.queryByRole('link', { name: NAME })).toBeNull();
  });
});
