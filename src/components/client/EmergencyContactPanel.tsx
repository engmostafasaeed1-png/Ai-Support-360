import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Phone, MessageSquare, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  consultantId: string | null;
  consultantName?: string;
  ticketId: string;
  ticketTitle: string;
  urgency: string;
}

function useConsultantContact(consultantId: string | null) {
  return useQuery({
    queryKey: ['consultant-contact', consultantId],
    enabled: !!consultantId,
    queryFn: async () => {
      if (!consultantId) return null;
      const { data: consultant } = await supabase
        .from('consultants')
        .select('user_id')
        .eq('id', consultantId)
        .maybeSingle();
      if (!consultant) return null;

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, phone')
        .eq('user_id', consultant.user_id)
        .maybeSingle();
      return profile;
    },
  });
}

export default function EmergencyContactPanel({ consultantId, consultantName, ticketId, ticketTitle, urgency }: Props) {
  const { data: contact } = useConsultantContact(consultantId);
  const phone = (contact as any)?.phone;
  const isEmergency = urgency === 'critical' || urgency === 'high';

  if (!consultantId) return null;

  const cleanPhone = phone?.replace(/[\s\-()]/g, '') || '';
  const whatsappUrl = cleanPhone ? `https://wa.me/${cleanPhone.replace('+', '')}?text=${encodeURIComponent(`Urgent: Regarding ticket "${ticketTitle}"`)}` : '';
  const smsUrl = cleanPhone ? `sms:${cleanPhone}?body=${encodeURIComponent(`Urgent: Regarding ticket "${ticketTitle}"`)}` : '';
  const callUrl = cleanPhone ? `tel:${cleanPhone}` : '';

  const logContact = async (method: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('audit_logs').insert({
        action: `emergency_contact.${method}`,
        entity_type: 'ticket',
        entity_id: ticketId,
        user_id: user.id,
        metadata: { consultant_id: consultantId, method } as any,
      });
    }
  };

  const handleCall = () => {
    if (!cleanPhone) {
      toast.error('Consultant phone number not available');
      return;
    }
    logContact('call');
    window.open(callUrl, '_self');
  };

  const handleSMS = () => {
    if (!cleanPhone) {
      toast.error('Consultant phone number not available');
      return;
    }
    logContact('sms');
    window.open(smsUrl, '_self');
  };

  const handleWhatsApp = () => {
    if (!cleanPhone) {
      toast.error('Consultant phone number not available');
      return;
    }
    logContact('whatsapp');
    window.open(whatsappUrl, '_blank');
  };

  const handlePortalMessage = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !consultantId) return;

    const { data: consultant } = await supabase
      .from('consultants')
      .select('user_id')
      .eq('id', consultantId)
      .maybeSingle();

    if (consultant) {
      await supabase.from('notifications').insert({
        user_id: consultant.user_id,
        title: '🚨 Emergency Contact',
        body: `Client urgently needs to reach you regarding "${ticketTitle}". Please respond immediately.`,
        type: 'ticket',
        link: `/consultant/cases/${ticketId}`,
      });
      toast.success('Emergency notification sent to consultant!');
    }
    logContact('portal_notification');
  };

  return (
    <Card className={`rounded-2xl ${isEmergency ? 'border-red-500/30 bg-red-500/5' : 'border-border/50'}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className={`w-4 h-4 ${isEmergency ? 'text-red-500' : 'text-amber-500'}`} />
          <span className="text-sm font-semibold text-foreground">
            {isEmergency ? 'Emergency Contact' : 'Quick Contact'}
          </span>
          {isEmergency && (
            <Badge variant="secondary" className="text-[9px] bg-red-500/15 text-red-600">Urgent</Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground mb-3">
          {consultantName ? `Reach ${consultantName} directly` : 'Contact assigned consultant'}
          {isEmergency ? ' — for critical issues requiring immediate attention.' : '.'}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-10 text-xs gap-2 border-green-500/30 hover:bg-green-500/10 text-green-700 dark:text-green-400"
            onClick={handleCall}
          >
            <Phone className="w-4 h-4" />
            Call Now
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-10 text-xs gap-2 border-blue-500/30 hover:bg-blue-500/10 text-blue-700 dark:text-blue-400"
            onClick={handleSMS}
          >
            <MessageSquare className="w-4 h-4" />
            Send SMS
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-10 text-xs gap-2 border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            onClick={handleWhatsApp}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            WhatsApp
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-10 text-xs gap-2"
            onClick={handlePortalMessage}
          >
            <AlertTriangle className="w-4 h-4" />
            Portal Alert
          </Button>
        </div>

        {!cleanPhone && (
          <p className="text-[10px] text-muted-foreground mt-2 text-center">
            📞 Phone/SMS/WhatsApp requires consultant phone number in profile. Portal alert is always available.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
