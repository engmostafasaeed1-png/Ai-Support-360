import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/hooks/useLanguage';
import { Button } from '@/components/ui/button';
import { Menu, X, Globe } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import logo from '@/assets/logo.png';

export default function Navbar() {
  const { t } = useTranslation();
  const { toggleLanguage, currentLang } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [isXs, setIsXs] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 339px)');
    const update = () => setIsXs(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
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

  const navItems = [
    { label: t('nav.home'), href: '/' },
    { label: t('nav.services'), href: '#categories' },
    { label: t('nav.consultants'), href: '#consultants' },
    { label: t('nav.pricing'), href: '#pricing' },
    { label: t('nav.knowledge'), href: '#faq' },
  ];

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled ? 'bg-white/95 backdrop-blur-xl border-b border-border/60 shadow-md' : 'bg-gradient-to-b from-black/40 via-black/20 to-transparent backdrop-blur-md'}`}>
      <div className={`container mx-auto flex items-center justify-between ${isXs ? 'h-14' : 'h-16'} sm:h-20 md:h-24 px-2 sm:px-4 gap-1.5 sm:gap-2`}>
        <Link
          to="/"
          aria-label="AI SAP Support Now — go to home"
          title="Go to home"
          className="flex items-center gap-1.5 sm:gap-2.5 md:gap-3 group rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background -ml-1.5 px-1.5 py-1.5 sm:py-1 min-h-[44px] cursor-pointer min-w-0 shrink active:bg-foreground/5"
        >
          <img
            src={logo}
            alt="AI SAP Support Now logo"
            width={96}
            height={96}
            className={`${isXs ? 'w-8 h-8' : 'w-9 h-9'} sm:w-14 sm:h-14 md:w-20 md:h-20 rounded-xl sm:rounded-2xl object-contain shrink-0 group-hover:scale-105 group-active:scale-95 transition-all duration-500 ${scrolled ? 'drop-shadow-md' : 'bg-white/95 p-1 ring-1 ring-white/40 shadow-xl drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]'}`}
          />
          {!isXs && (
            <span className={`font-black leading-tight tracking-tight transition-colors duration-500 whitespace-nowrap ${scrolled ? 'text-foreground group-hover:text-primary' : 'text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] group-hover:text-white/90'}`}>
              {/* ≤640px: ultra-short initials */}
              <span className="inline sm:hidden text-sm">SAP Support</span>
              {/* 640–1023px: short brand */}
              <span className="hidden sm:inline lg:hidden text-lg md:text-xl">AI SAP Support</span>
              {/* ≥1024px: full brand */}
              <span className="hidden lg:inline text-2xl">AI SAP Support Now</span>
            </span>
          )}
        </Link>

        <div className="hidden md:flex items-center gap-0.5">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`text-sm font-semibold px-3.5 py-2 rounded-xl transition-all ${scrolled ? 'text-muted-foreground hover:text-foreground hover:bg-muted/50' : 'text-white/90 hover:text-white hover:bg-white/15 drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]'}`}
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-2">
          <button
            onClick={toggleLanguage}
            className={`flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl transition-all ${scrolled ? 'text-muted-foreground hover:text-foreground hover:bg-muted/50' : 'text-white/90 hover:text-white hover:bg-white/15 drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]'}`}
          >
            <Globe className="w-4 h-4" />
            {t('nav.language')}
          </button>
          <Link to="/login">
            <Button variant={scrolled ? 'ghost' : 'outline'} size="sm" className={`rounded-xl font-semibold ${scrolled ? '' : 'bg-white/10 border-white/40 text-white hover:bg-white/20 hover:text-white backdrop-blur-md'}`}>
              {t('nav.login')}
            </Button>
          </Link>
          <Link to="/signup">
            <Button size="sm" className="gradient-primary border-0 shadow-lg rounded-xl font-semibold px-5">
              {t('nav.signup')}
            </Button>
          </Link>
        </div>

        <button
          className={`md:hidden inline-flex items-center justify-center -mr-1.5 h-11 w-11 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 transition-colors active:scale-95 ${scrolled ? 'hover:bg-muted/60 active:bg-muted' : 'hover:bg-white/15 active:bg-white/20'}`}
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
        >
          <span className="relative w-6 h-6 inline-flex items-center justify-center">
            <Menu
              className={`absolute w-6 h-6 transition-all duration-300 ${scrolled ? 'text-foreground' : 'text-white drop-shadow-md'} ${mobileOpen ? 'opacity-0 -rotate-90 scale-75' : 'opacity-100 rotate-0 scale-100'}`}
            />
            <X
              className={`absolute w-6 h-6 transition-all duration-300 ${scrolled ? 'text-foreground' : 'text-white drop-shadow-md'} ${mobileOpen ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-90 scale-75'}`}
            />
          </span>
        </button>
      </div>

      {/* Backdrop */}
      <div
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
        className={`md:hidden fixed inset-0 top-full bg-foreground/30 backdrop-blur-sm transition-opacity duration-300 ${mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      />

      {/* Slide-down panel — absolute so navbar height never shifts */}
      <div
        id="mobile-menu"
        role="menu"
        aria-hidden={!mobileOpen}
        className={`md:hidden absolute left-0 right-0 top-full origin-top border-t border-border/30 bg-background/95 backdrop-blur-xl shadow-2xl will-change-transform transition-[opacity,transform] duration-300 ease-out ${
          mobileOpen
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-3 pointer-events-none'
        }`}
      >
        <div className="p-4 space-y-1.5">
          {navItems.map((item, i) => (
            <a
              key={item.href}
              href={item.href}
              role="menuitem"
              tabIndex={mobileOpen ? 0 : -1}
              style={{ transitionDelay: mobileOpen ? `${60 + i * 35}ms` : '0ms' }}
              className={`block text-sm font-medium text-muted-foreground hover:text-foreground px-3 py-3 rounded-xl hover:bg-muted/60 transition-all duration-300 ${
                mobileOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'
              }`}
              onClick={() => setMobileOpen(false)}
            >
              {item.label}
            </a>
          ))}
          <div className="flex items-center gap-2 pt-3 mt-2 border-t border-border/50">
            <button
              onClick={toggleLanguage}
              tabIndex={mobileOpen ? 0 : -1}
              className="flex items-center gap-1.5 text-sm text-muted-foreground px-3 py-2 rounded-xl hover:bg-muted/60 transition-colors"
            >
              <Globe className="w-4 h-4" />
              {t('nav.language')}
            </button>
          </div>
          <div className="flex gap-2 pt-1">
            <Link to="/login" className="flex-1" tabIndex={mobileOpen ? 0 : -1}>
              <Button variant="outline" size="sm" className="w-full rounded-xl">{t('nav.login')}</Button>
            </Link>
            <Link to="/signup" className="flex-1" tabIndex={mobileOpen ? 0 : -1}>
              <Button size="sm" className="w-full gradient-primary border-0 shadow-lg rounded-xl">{t('nav.signup')}</Button>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
