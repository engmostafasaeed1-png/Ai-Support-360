import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CircleHelp, Compass, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useConsultantTour } from '@/components/tour/ConsultantTour';
import { useAssignmentPolicyText } from '@/components/consultant/AssignmentPolicyNote';
import { policyText } from '../../../supabase/functions/_shared/assignmentPolicy';

/** Short answers built only from facts the platform states elsewhere. */
export const QUICK_GUIDE: { key: string; q: string; a: string }[] = [
  { key: 'bids', q: 'How do bids work?', a: 'Each open request can have a bidding deadline. Before bidding you can ask the client a question. Until the client answers you can revise or withdraw your bid, and a client can send you one counter-offer. The client chooses one consultant; the other bidders are told that another consultant was chosen.' },
  { key: 'paid', q: 'How do I get paid?', a: 'The client pays the platform. The platform transfers your payout within 15 business days (Sunday to Thursday) after it receives the client\'s payment. Your bank details are private: only you and the platform administrators can see them.' },
  { key: 'reply', q: 'How fast must I answer an assignment request?', a: policyText() },
  { key: 'critical', q: 'How do critical requests work?', a: 'A critical request sounds an alarm in your portal. When you reply within 30 minutes, your rate for that request can be raised by 30%.' },
  { key: 'trust', q: 'How are my trust score and ratings built?', a: 'Your trust score is built from your verified certificates, your experience, your AI interview result and the reviews clients write after working with you.' },
  { key: 'alerts', q: 'How do alerts work?', a: 'New requests and bid answers arrive as in-app notifications. In Settings you can also turn on phone alerts and Telegram so you never miss a critical request.' },
  { key: 'chat', q: 'What may I share in chat?', a: 'Do not share e-mail addresses, phone numbers or links. Contact details stay inside the portal until you are assigned to the request.' },
];

export default function QuickGuideSheet() {
  const { t } = useTranslation();
  const tour = useConsultantTour();
  const [open, setOpen] = useState(false);
  // The reply policy follows the administrator's current timings (and the reader's language), not the static default.
  const replyPolicy = useAssignmentPolicyText();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('quick_guide.button', 'Help and guide')} data-tour="help-button">
          <CircleHelp className="w-4 h-4" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('quick_guide.title', 'Quick guide')}</SheetTitle>
          <SheetDescription>{t('quick_guide.subtitle', 'Short answers to the most common questions.')}</SheetDescription>
        </SheetHeader>
        <Accordion type="single" collapsible className="mt-4">
          {QUICK_GUIDE.map((item) => (
            <AccordionItem key={item.key} value={item.key}>
              <AccordionTrigger className="text-sm text-start">{t(`quick_guide.${item.key}_q`, item.q)}</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">{item.key === 'reply' ? replyPolicy : t(`quick_guide.${item.key}_a`, item.a)}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        <div className="mt-6 flex flex-col gap-2">
          <Button className="gap-2" onClick={() => { setOpen(false); tour.start(); }}>
            <Compass className="w-4 h-4" aria-hidden="true" /> {t('quick_guide.tour_again', 'Take the tour again')}
          </Button>
          <Button variant="outline" asChild className="gap-2">
            <Link to="/#contact" onClick={() => setOpen(false)}>
              <LifeBuoy className="w-4 h-4" aria-hidden="true" /> {t('quick_guide.contact', 'Contact support')}
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
