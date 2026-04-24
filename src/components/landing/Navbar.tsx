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
    const mq = window.matchMedia('(max-width: 380px)');
    const update = () => setIsXs(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const navItems = [
    { label: t('nav.home'), href: '/' },
    { label: t('nav.services'), href: '#categories' },
    { label: t('nav.consultants'), href: '#consultants' },
    { label: t('nav.pricing'), href: '#pricing' },
    { label: t('nav.knowledge'), href: '#faq' },
  ];

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled ? 'bg-white/95 backdrop-blur-xl border-b border-border/60 shadow-md' : 'bg-gradient-to-b from-black/40 via-black/20 to-transparent backdrop-blur-md'}`}>
      <div className="container mx-auto flex items-center justify-between h-16 sm:h-20 md:h-24 px-3 sm:px-4 gap-2">
        <Link
          to="/"
          aria-label="AI SAP Support Now — go to home"
          title="Go to home"
          className="flex items-center gap-1.5 sm:gap-2.5 md:gap-3 group rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background py-1 cursor-pointer min-w-0 shrink"
        >
          <img
            src={logo}
            alt="AI SAP Support Now logo"
            width={96}
            height={96}
            className={`w-9 h-9 sm:w-14 sm:h-14 md:w-20 md:h-20 rounded-xl sm:rounded-2xl object-contain shrink-0 group-hover:scale-105 group-active:scale-95 transition-all duration-500 ${scrolled ? 'drop-shadow-md' : 'bg-white/95 p-1 ring-1 ring-white/40 shadow-xl drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]'}`}
          />
          <span className={`font-black text-[13px] leading-tight sm:text-lg md:text-2xl tracking-tight transition-colors duration-500 truncate ${scrolled ? 'text-foreground group-hover:text-primary' : 'text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] group-hover:text-white/90'}`}>
            <span className="sm:hidden">AI SAP Support</span>
            <span className="hidden sm:inline">AI SAP Support Now</span>
          </span>
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

        <button className="md:hidden" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">
          {mobileOpen ? (
            <X className={`w-5 h-5 ${scrolled ? 'text-foreground' : 'text-white drop-shadow-md'}`} />
          ) : (
            <Menu className={`w-5 h-5 ${scrolled ? 'text-foreground' : 'text-white drop-shadow-md'}`} />
          )}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-border/30 bg-background/95 backdrop-blur-xl p-4 space-y-3 animate-fade-in shadow-xl">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="block text-sm font-medium text-muted-foreground hover:text-foreground px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-all"
              onClick={() => setMobileOpen(false)}
            >
              {item.label}
            </a>
          ))}
          <div className="flex items-center gap-2 pt-3 border-t border-border/50">
            <button onClick={toggleLanguage} className="flex items-center gap-1.5 text-sm text-muted-foreground px-3 py-2 rounded-xl hover:bg-muted/50">
              <Globe className="w-4 h-4" />
              {t('nav.language')}
            </button>
          </div>
          <div className="flex gap-2">
            <Link to="/login" className="flex-1">
              <Button variant="outline" size="sm" className="w-full rounded-xl">{t('nav.login')}</Button>
            </Link>
            <Link to="/signup" className="flex-1">
              <Button size="sm" className="w-full gradient-primary border-0 shadow-lg rounded-xl">{t('nav.signup')}</Button>
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
