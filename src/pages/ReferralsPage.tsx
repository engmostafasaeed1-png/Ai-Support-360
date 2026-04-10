import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useReferralCode, useMyReferrals, useMyRewards, getReferralLink } from '@/hooks/useReferrals';
import { Copy, Check, Mail, Share2, QrCode, Gift, Users, DollarSign, Send, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import QRCodeDisplay from '@/components/referral/QRCodeDisplay';
import EmailInviteForm from '@/components/referral/EmailInviteForm';

export default function ReferralsPage() {
  const { data: code, isLoading: codeLoading } = useReferralCode();
  const { data: referrals, isLoading: refsLoading } = useMyReferrals();
  const { data: rewards } = useMyRewards();
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  const link = code ? getReferralLink(code) : '';

  const copyLink = () => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success('Referral link copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  const shareWhatsApp = () => {
    const text = encodeURIComponent(`Join me on AI SAP Support Now — the smartest SAP support platform! Use my referral link and get a $15 welcome bonus: ${link}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const shareLinkedIn = () => {
    const url = encodeURIComponent(link);
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`, '_blank');
  };

  const shareTwitter = () => {
    const text = encodeURIComponent(`Join AI SAP Support Now — the smartest SAP support platform! Get a $15 welcome bonus with my referral: ${link}`);
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
  };

  const totalReferred = (referrals || []).length;
  const successfulReferrals = (referrals || []).filter(r => r.status === 'rewarded' || r.status === 'registered').length;
  const totalEarned = (rewards || []).filter((r: any) => r.status === 'applied').reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const pendingRewards = (rewards || []).filter((r: any) => r.status === 'pending').reduce((s: number, r: any) => s + (r.amount || 0), 0);

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    registered: 'bg-blue-100 text-blue-800',
    rewarded: 'bg-emerald-100 text-emerald-800',
    expired: 'bg-muted text-muted-foreground',
    applied: 'bg-emerald-100 text-emerald-800',
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium">
          <Gift className="w-4 h-4" /> Referral Program
        </div>
        <h1 className="text-2xl font-bold text-foreground">Invite & Earn Together</h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Share your unique link — you earn <strong>$25</strong> credit, your friend gets <strong>$15</strong> welcome bonus!
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Invited', value: totalReferred, icon: Users, color: 'text-blue-600' },
          { label: 'Joined', value: successfulReferrals, icon: Check, color: 'text-emerald-600' },
          { label: 'Earned', value: `$${totalEarned}`, icon: DollarSign, color: 'text-primary' },
          { label: 'Pending', value: `$${pendingRewards}`, icon: Gift, color: 'text-amber-600' },
        ].map(s => (
          <Card key={s.label} className="text-center">
            <CardContent className="p-3">
              <s.icon className={`w-5 h-5 mx-auto mb-1 ${s.color}`} />
              <p className="text-lg font-bold text-foreground">{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Sharing Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Share2 className="w-4 h-4 text-primary" /> Share Your Link
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Copy Link */}
          {codeLoading ? (
            <Skeleton className="h-10" />
          ) : (
            <div className="flex gap-2">
              <Input value={link} readOnly className="text-xs font-mono bg-muted/30" />
              <Button variant="outline" size="sm" onClick={copyLink} className="shrink-0">
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          )}

          {/* Referral Code */}
          <div className="flex items-center justify-center gap-2 py-2">
            <span className="text-xs text-muted-foreground">Your code:</span>
            <Badge variant="secondary" className="text-sm font-mono tracking-wider">{code || '...'}</Badge>
          </div>

          {/* Share buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button variant="outline" className="gap-2 text-xs" onClick={() => setShowEmail(true)}>
              <Mail className="w-4 h-4" /> Email
            </Button>
            <Button variant="outline" className="gap-2 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={shareWhatsApp}>
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </Button>
            <Button variant="outline" className="gap-2 text-xs text-blue-700 border-blue-200 hover:bg-blue-50" onClick={shareLinkedIn}>
              <Share2 className="w-4 h-4" /> LinkedIn
            </Button>
            <Button variant="outline" className="gap-2 text-xs" onClick={() => setShowQR(!showQR)}>
              <QrCode className="w-4 h-4" /> QR Code
            </Button>
          </div>

          {/* QR Code */}
          {showQR && <QRCodeDisplay url={link} />}

          {/* Email Form */}
          {showEmail && <EmailInviteForm referralCode={code || ''} onClose={() => setShowEmail(false)} />}
        </CardContent>
      </Card>

      {/* Referrals & Rewards Tabs */}
      <Tabs defaultValue="referrals">
        <TabsList className="w-full">
          <TabsTrigger value="referrals" className="flex-1">Invitations ({totalReferred})</TabsTrigger>
          <TabsTrigger value="rewards" className="flex-1">Rewards ({(rewards || []).length})</TabsTrigger>
        </TabsList>

        <TabsContent value="referrals" className="mt-3 space-y-2">
          {refsLoading ? (
            [1, 2, 3].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)
          ) : (referrals || []).length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
              No invitations yet. Share your link to get started!
            </CardContent></Card>
          ) : (
            (referrals || []).map((r: any) => (
              <Card key={r.id}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                    {r.source === 'email' ? '✉️' : r.source === 'whatsapp' ? '💬' : r.source === 'qr' ? '📱' : '🔗'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {r.referred_email || 'Link shared'}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()} • via {r.source}
                    </p>
                  </div>
                  <Badge className={`text-[10px] ${statusColors[r.status] || ''}`}>{r.status}</Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="rewards" className="mt-3 space-y-2">
          {(rewards || []).length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
              No rewards yet. Invite friends to earn credits!
            </CardContent></Card>
          ) : (
            (rewards || []).map((r: any) => (
              <Card key={r.id}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">${r.amount} {r.reward_type}</p>
                    <p className="text-[10px] text-muted-foreground">{r.description}</p>
                  </div>
                  <Badge className={`text-[10px] ${statusColors[r.status] || ''}`}>{r.status}</Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Tier Progress */}
      <Card>
        <CardContent className="p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-foreground">Referral Tier</span>
            <Badge variant="secondary">{successfulReferrals >= 10 ? '🥇 Gold' : successfulReferrals >= 5 ? '🥈 Silver' : '🥉 Bronze'}</Badge>
          </div>
          <Progress value={Math.min((successfulReferrals / 10) * 100, 100)} className="h-2 mb-1" />
          <p className="text-[10px] text-muted-foreground">
            {successfulReferrals >= 10 ? 'Gold tier — maximum rewards!' : `${10 - successfulReferrals} more to reach Gold tier`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
