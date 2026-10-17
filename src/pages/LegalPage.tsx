import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import raw from '@/content/legal-policies.md?raw';

export const LEGAL_PAGES = [
  { slug: 'privacy-policy', title: 'Privacy Policy', heading: 'Privacy Policy' },
  { slug: 'terms-and-conditions', title: 'Terms & Conditions', heading: 'Terms & Conditions' },
  { slug: 'refund-policy', title: 'Refund Policy', heading: 'Refund Policy' },
  { slug: 'subscription-and-cancellation', title: 'Subscription & Cancellation', heading: 'Subscription & Cancellation Policy' },
  { slug: 'service-delivery', title: 'Service Delivery', heading: 'Service Delivery & Activation Policy' },
  { slug: 'cookie-policy', title: 'Cookie Policy', heading: 'Cookie Policy' },
  { slug: 'acceptable-use', title: 'Acceptable Use', heading: 'Acceptable Use Policy' },
] as const;

const normalized = raw.replace(/\r\n/g, '\n');

function sectionFor(heading: string): string {
  const parts = normalized.split(/^# /m);
  const part = parts.find((p) => p.startsWith(heading + '\n')) ?? '';
  // Show unresolved placeholders as highlighted chips so they are easy to spot.
  return part.slice(heading.length + 1).replace(/\[([A-Z][^\]]*)\]/g, '`[$1]`');
}

export default function LegalPage({ slug }: { slug: string }) {
  const page = LEGAL_PAGES.find((p) => p.slug === slug)!;
  const body = sectionFor(page.heading);
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main
        className="flex-1 container mx-auto px-4 pb-16"
        style={{ paddingTop: 'calc(var(--public-header-h, 6rem) + 2rem)' }}
      >
        <div className="grid lg:grid-cols-[220px_1fr] gap-8 max-w-6xl mx-auto">
          <nav aria-label="Legal pages" className="lg:sticky lg:top-36 self-start">
            <ul className="flex lg:flex-col gap-2 overflow-x-auto pb-2">
              {LEGAL_PAGES.map((p) => (
                <li key={p.slug} className="shrink-0">
                  <Link
                    to={`/${p.slug}`}
                    className={`block rounded-xl px-3 py-2 text-sm transition-colors ${
                      p.slug === slug ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <article className="rounded-2xl border border-border/50 bg-card shadow-sm p-6 sm:p-10">
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">{page.heading}</h1>
            <ReactMarkdown
              components={{
                h2: ({ children }) => <h2 className="text-xl font-semibold text-foreground mt-10 mb-3">{children}</h2>,
                h3: ({ children }) => <h3 className="text-lg font-semibold text-foreground mt-6 mb-2">{children}</h3>,
                p: ({ children }) => <p className="text-muted-foreground leading-7 mb-4">{children}</p>,
                ul: ({ children }) => <ul className="list-disc ps-6 space-y-2 mb-4 text-muted-foreground leading-7">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal ps-6 space-y-2 mb-4 text-muted-foreground leading-7">{children}</ol>,
                strong: ({ children }) => <strong className="text-foreground font-semibold">{children}</strong>,
                a: ({ href, children }) => <a href={href} className="text-primary underline">{children}</a>,
                code: ({ children }) => (
                  <mark className="rounded px-1 py-0.5 bg-accent/15 text-accent font-semibold text-[0.9em]" title="To complete before launch">
                    {children}
                  </mark>
                ),
              }}
            >
              {body}
            </ReactMarkdown>
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
}
