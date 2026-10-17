import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/hooks/useLanguage';
import { Button } from '@/components/ui/button';
import { Menu, X, Globe } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import horizontalLogo from '@/assets/brand/horizontal-tight.webp.asset.json';

export default function Navbar() {
  const { t } = useTranslation();
  const { toggleLanguage } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const location = useLocation();

  // Publish the real header height so fixed-offset pages can auto-fit it.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const setVar = () =>
      document.documentElement.style.setProperty('--public-header-h', `${el.offsetHeight}px`);
    setVar();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(setVar);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      document.documentElement.style.removeProperty('--public-header-h');
    };
  }, []);

  // Close mobile menu on Esc
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  // Deepen the banner's elevation once the page is scrolled
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navItems = [
    { label: t('nav.home'), href: '/' },
    { label: t('nav.services'), href: '/#categories' },
    { label: t('nav.consultants'), href: '/#consultants' },
    { label: t('nav.pricing'), href: '/#pricing' },
    { label: t('nav.knowledge'), href: '/#faq' },
    { label: t('nav.for_consultants', 'For consultants'), href: '/for-consultants' },
  ];

  // Current page: hash items match the home section, path items match the path.
  const isActive = (href: string) => {
    const [path, hash] = href.split('#');
    if (hash) return location.pathname === '/' && location.hash === `#${hash}`;
    if (path === '/') return location.pathname === '/' && !location.hash;
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  return (
    <header
      ref={navRef}
      className={`fixed top-0 left-0 right-0 z-50 bg-gradient-to-b from-white via-white/95 to-white/90 backdrop-blur-xl transition-shadow duration-300 ${
        scrolled
          ? 'shadow-[0_14px_44px_-18px_hsl(var(--primary)/0.35)]'
          : 'shadow-[0_8px_28px_-22px_hsl(var(--foreground)/0.45)]'
      }`}
    >
      <div className="container mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 h-[84px] sm:h-[100px] lg:h-[112px] xl:h-[116px]">
        <Link
          to="/"
          aria-label="AI Support 360 — go to home"
          title="Go to home"
          className="group flex shrink-0 items-center rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        >
          <img
            src={horizontalLogo.url}
            alt="AI Support 360"
            width={1711}
            height={429}
            className="h-[58px] sm:h-[72px] lg:h-[80px] xl:h-[82px] w-auto max-w-full object-contain object-left motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-[1.03]"
          />
        </Link>

        <nav aria-label="Main" className="hidden xl:flex items-center gap-0.5">
          {navItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className="rounded-full aria-[current=page]:bg-primary/[0.08] aria-[current=page]:text-primary px-3 py-2.5 text-sm font-semibold text-muted-foreground outline-none transition-colors duration-200 hover:bg-primary/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden xl:flex items-center gap-2">
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-2 text-sm font-semibold text-muted-foreground outline-none transition-colors duration-200 hover:border-primary/40 hover:bg-primary/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Globe className="w-4 h-4" />
            {t('nav.language')}
          </button>
          <Link to="/login">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full px-4 text-sm font-semibold text-foreground hover:bg-primary/[0.06]"
            >
              {t('nav.login')}
            </Button>
          </Link>
          <Link to="/signup">
            <Button
              size="sm"
              className="gradient-primary rounded-full border-0 px-5 py-5 text-sm font-semibold shadow-[0_12px_30px_-12px_hsl(var(--primary)/0.75)] outline-none transition-all duration-200 hover:shadow-[0_18px_40px_-12px_hsl(var(--primary)/0.85)] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-safe:hover:-translate-y-0.5"
            >
              {t('nav.signup')}
            </Button>
          </Link>
        </div>

        <button
          className="xl:hidden inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border/70 text-foreground outline-none transition-colors duration-200 hover:border-primary/40 hover:bg-primary/[0.05] focus-visible:ring-2 focus-visible:ring-primary active:scale-95"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
        >
          <span className="relative w-6 h-6 inline-flex items-center justify-center">
            <Menu
              className={`absolute w-6 h-6 text-foreground transition-all duration-300 ${mobileOpen ? 'opacity-0 -rotate-90 scale-75' : 'opacity-100 rotate-0 scale-100'}`}
            />
            <X
              className={`absolute w-6 h-6 text-foreground transition-all duration-300 ${mobileOpen ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-90 scale-75'}`}
            />
          </span>
        </button>
      </div>

      {/* Hairline accent along the bottom of the banner */}
      <div
        aria-hidden="true"
        className="h-px w-full bg-gradient-to-r from-transparent via-primary/30 to-transparent"
      />

      {/* Backdrop */}
      <div
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
        className={`xl:hidden fixed inset-0 top-full bg-foreground/45 backdrop-blur-sm transition-opacity duration-300 ${mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Slide-down panel — absolute so navbar height never shifts */}
      <div
        id="mobile-menu"
        role="menu"
        aria-hidden={!mobileOpen}
        className={`xl:hidden absolute left-0 right-0 top-full origin-top border-t border-border/30 bg-background shadow-2xl will-change-transform transition-[opacity,transform] duration-300 ease-out ${
          mobileOpen
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-3 pointer-events-none'
        }`}
      >
        <div className="p-4 space-y-1.5">
          {navItems.map((item, i) => (
            <Link
              key={item.href}
              to={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              role="menuitem"
              tabIndex={mobileOpen ? 0 : -1}
              style={{ transitionDelay: mobileOpen ? `${60 + i * 35}ms` : '0ms' }}
              className={`block rounded-full px-4 py-3 text-sm font-medium text-muted-foreground outline-none transition-all duration-300 hover:bg-primary/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary aria-[current=page]:bg-primary/[0.08] aria-[current=page]:text-primary ${
                mobileOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'
              }`}
              onClick={() => setMobileOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          <div className="flex items-center gap-2 pt-3 mt-2 border-t border-border/50">
            <button
              onClick={toggleLanguage}
              tabIndex={mobileOpen ? 0 : -1}
              className="flex items-center gap-1.5 rounded-full border border-border/70 px-3.5 py-2 text-sm font-semibold text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:bg-primary/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Globe className="w-4 h-4" />
              {t('nav.language')}
            </button>
          </div>
          <div className="flex gap-2 pt-1">
            <Link to="/login" className="flex-1" tabIndex={mobileOpen ? 0 : -1}>
              <Button variant="outline" size="sm" className="w-full rounded-full font-semibold">
                {t('nav.login')}
              </Button>
            </Link>
            <Link to="/signup" className="flex-1" tabIndex={mobileOpen ? 0 : -1}>
              <Button size="sm" className="gradient-primary w-full rounded-full border-0 font-semibold shadow-[0_12px_30px_-12px_hsl(var(--primary)/0.75)]">
                {t('nav.signup')}
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
