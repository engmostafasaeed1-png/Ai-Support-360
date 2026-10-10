import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  LifeBuoy, Search, MessageCircle, BookOpen, FileText,
  Video, Mail, Phone, ArrowRight, Sparkles, Clock, Shield,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { CONTACT_PHONE_DISPLAY, CONTACT_PHONE_HREF } from '@/lib/contact';

const quickActions = [
  {
    icon: MessageCircle,
    title: 'Live Chat',
    description: 'Chat with our support team in real-time',
    link: '/client/chat',
    color: 'bg-blue-500/10 text-blue-600',
  },
  {
    icon: Sparkles,
    title: 'AI Assistant',
    description: 'Get instant answers from our AI chatbot',
    link: '/client/chat',
    color: 'bg-violet-500/10 text-violet-600',
  },
  {
    icon: FileText,
    title: 'Submit Ticket',
    description: 'Create a new support request for your issue',
    link: '/client/new-request',
    color: 'bg-emerald-500/10 text-emerald-600',
  },
  {
    icon: BookOpen,
    title: 'Knowledge Base',
    description: 'Browse articles and solutions',
    link: '/client/knowledge',
    color: 'bg-amber-500/10 text-amber-600',
  },
];

const faqItems = [
  { q: 'How do I create a new support ticket?', a: 'Navigate to "New Request" from the sidebar or dashboard to submit a ticket.' },
  { q: 'How are consultants matched to my ticket?', a: 'Our AI analyzes your issue, required SAP modules, and urgency to match the best consultant.' },
  { q: 'What are the SLA response times?', a: 'Critical: 1 hr, High: 2 hrs, Medium: 4 hrs, Low: 8 hrs. View full details on the SLA page.' },
  { q: 'How do payments and invoicing work?', a: 'Payments are processed per milestone or hourly. Invoices are generated automatically.' },
  { q: 'Can I request a specific consultant?', a: 'Yes, browse the Consultants page and send a direct request to your preferred expert.' },
];

interface ContactChannel {
  icon: LucideIcon;
  label: string;
  value: string;
  color: string;
  href?: string;
  ltr?: boolean;
}

const contactChannels: ContactChannel[] = [
  { icon: Mail, label: 'Email Support', value: 'info@qurtubatalks.com', href: 'mailto:info@qurtubatalks.com', ltr: true, color: 'text-blue-500' },
  { icon: Phone, label: 'Phone Support', value: CONTACT_PHONE_DISPLAY, href: CONTACT_PHONE_HREF, ltr: true, color: 'text-emerald-500' },
  { icon: Clock, label: 'Business Hours', value: 'Sun–Thu, 8 AM – 6 PM (AST)', color: 'text-amber-500' },
  { icon: Shield, label: 'Emergency', value: '24/7 for Critical Issues', color: 'text-destructive' },
];

export default function SupportPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center space-y-4 py-4">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <LifeBuoy className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold">{t('sidebar.support', 'Help & Support')}</h1>
        <p className="text-muted-foreground max-w-md mx-auto">How can we help you today? Search our resources or reach out to our team.</p>
        <div className="max-w-lg mx-auto relative">
          <Search className="w-4 h-4 absolute start-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search help articles, FAQs..." className="ps-10 h-12 rounded-xl bg-muted/40 border-border/40" />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {quickActions.map((action) => (
          <Link to={action.link} key={action.title}>
            <Card className="rounded-2xl border-border/50 hover:shadow-premium hover:border-primary/20 transition-all h-full group cursor-pointer">
              <CardContent className="p-5 flex flex-col items-start gap-3">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${action.color}`}>
                  <action.icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{action.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{action.description}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-1 transition-all mt-auto" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* FAQ */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-4">Frequently Asked Questions</h2>
          <div className="divide-y divide-border">
            {faqItems.map((faq, i) => (
              <div key={i} className="py-4 first:pt-0 last:pb-0">
                <h3 className="text-sm font-medium text-foreground">{faq.q}</h3>
                <p className="text-sm text-muted-foreground mt-1.5">{faq.a}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Contact */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {contactChannels.map((ch) => (
          <Card key={ch.label} className="rounded-2xl border-border/50">
            <CardContent className="p-5 flex items-start gap-3">
              <ch.icon className={`w-5 h-5 ${ch.color} shrink-0 mt-0.5`} />
              <div>
                <p className="text-xs text-muted-foreground">{ch.label}</p>
                {ch.href ? (
                  <a href={ch.href} dir={ch.ltr ? 'ltr' : undefined} className="block text-sm font-medium text-foreground mt-0.5 hover:underline">{ch.value}</a>
                ) : (
                  <p className="text-sm font-medium text-foreground mt-0.5">{ch.value}</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="text-center py-4">
        <p className="text-sm text-muted-foreground">
          Still need help?{' '}
          <Link to="/client/new-request" className="text-primary font-medium hover:underline">
            Create a support ticket
          </Link>
        </p>
      </div>
    </div>
  );
}
