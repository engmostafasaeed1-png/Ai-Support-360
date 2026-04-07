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

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems = [
    { label: t('nav.home'), href: '/' },
    { label: t('nav.services'), href: '#categories' },
    { label: t('nav.consultants'), href: '#consultants' },
    { label: t('nav.pricing'), href: '#pricing' },
    { label: t('nav.knowledge'), href: '#faq' },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 transition-all duration-500 bg-white/95 backdrop-blur-xl border-b border-border/50 shadow-sm">
      <div className="container mx-auto flex items-center justify-between h-16 px-4">
        <Link to="/" className="flex items-center gap-2 group">
          <img src={logo} alt="AI SAP Support Hub" className="w-10 h-10 rounded-xl object-contain group-hover:scale-110 transition-transform shadow-premium" />
          <span className={`font-bold text-lg transition-colors ${scrolled ? 'text-foreground' : 'text-primary-foreground'}`}>
            AI SAP Support Hub
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`text-sm font-medium px-3 py-2 rounded-lg transition-all hover:bg-primary-foreground/10 ${
                scrolled ? 'text-muted-foreground hover:text-foreground' : 'text-primary-foreground/80 hover:text-primary-foreground'
              }`}
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-2">
          <button
            onClick={toggleLanguage}
            className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg transition-all hover:bg-primary-foreground/10 ${
              scrolled ? 'text-muted-foreground hover:text-foreground' : 'text-primary-foreground/80 hover:text-primary-foreground'
            }`}
          >
            <Globe className="w-4 h-4" />
            {t('nav.language')}
          </button>
          <Link to="/login">
            <Button variant="ghost" size="sm" className={scrolled ? '' : 'text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground'}>
              {t('nav.login')}
            </Button>
          </Link>
          <Link to="/signup">
            <Button size="sm" className={scrolled ? 'gradient-primary border-0 shadow-premium' : 'bg-primary-foreground text-primary hover:bg-primary-foreground/90 shadow-xl'}>
              {t('nav.signup')}
            </Button>
          </Link>
        </div>

        <button className="md:hidden" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? (
            <X className={`w-5 h-5 ${scrolled ? 'text-foreground' : 'text-primary-foreground'}`} />
          ) : (
            <Menu className={`w-5 h-5 ${scrolled ? 'text-foreground' : 'text-primary-foreground'}`} />
          )}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-border/30 bg-background/95 backdrop-blur-xl p-4 space-y-3 animate-fade-in shadow-lg">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="block text-sm font-medium text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg hover:bg-muted/50 transition-all"
              onClick={() => setMobileOpen(false)}
            >
              {item.label}
            </a>
          ))}
          <div className="flex items-center gap-2 pt-3 border-t border-border/50">
            <button onClick={toggleLanguage} className="flex items-center gap-1.5 text-sm text-muted-foreground px-3 py-2 rounded-lg hover:bg-muted/50">
              <Globe className="w-4 h-4" />
              {t('nav.language')}
            </button>
          </div>
          <div className="flex gap-2">
            <Link to="/login" className="flex-1">
              <Button variant="outline" size="sm" className="w-full">{t('nav.login')}</Button>
            </Link>
            <Link to="/signup" className="flex-1">
              <Button size="sm" className="w-full gradient-primary border-0 shadow-premium">{t('nav.signup')}</Button>
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
