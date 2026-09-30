import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Send, CalendarIcon, Mail, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAvailableConsultants, useShareRemoteConfig } from '@/hooks/useSharedRemoteConfigs';
import { toast } from 'sonner';
import { connectionIdHint, isValidConnectionId, normalizeConnectionId } from '@/lib/remoteAccess';

interface ShareRemoteConfigDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  toolType: string;
  defaultConfig?: Record<string, unknown>;
}

export default function ShareRemoteConfigDialog({
  open,
  onOpenChange,
  toolType,
  defaultConfig = {},
}: ShareRemoteConfigDialogProps) {
  const { data: consultants, isLoading: loadingConsultants } = useAvailableConsultants();
  const shareMutation = useShareRemoteConfig();
  const [consultantId, setConsultantId] = useState('');
  const [message, setMessage] = useState('');
  const [alias, setAlias] = useState((defaultConfig.alias as string) || '');
  const [connectionId, setConnectionId] = useState((defaultConfig.connectionId as string) || '');
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [shareMode, setShareMode] = useState<'consultant' | 'email'>('consultant');
  const [recipientEmail, setRecipientEmail] = useState('');

  useEffect(() => {
    if (open) {
      setAlias((defaultConfig?.alias as string) || '');
      setConnectionId((defaultConfig?.connectionId as string) || '');
    }
  }, [open, defaultConfig]);

  const handleShare = async () => {
    const cleanId = normalizeConnectionId(toolType, connectionId);
    if (!isValidConnectionId(toolType, cleanId)) {
      toast.error(connectionIdHint(toolType));
      return;
    }
    if (shareMode === 'consultant') {
      if (!consultantId) return;
      await shareMutation.mutateAsync({
        consultant_id: consultantId,
        tool_type: toolType,
        config: {
          ...defaultConfig,
          alias,
          connectionId: cleanId,
          startDate: startDate?.toISOString() || null,
          endDate: endDate?.toISOString() || null,
        },
        message: message || undefined,
      });
    } else {
      if (!recipientEmail) return;
      const subject = encodeURIComponent(`${toolLabel} Remote Access Shared`);
      const period = startDate && endDate
        ? `\nValid: ${format(startDate, 'MMM d, yyyy')} → ${format(endDate, 'MMM d, yyyy')}`
        : startDate ? `\nStarting: ${format(startDate, 'MMM d, yyyy')}` : '';
      const body = encodeURIComponent(
        `Hi,\n\nI'm sharing ${toolLabel} remote access credentials with you.\n\nTool: ${toolLabel}\nAlias: ${alias || 'N/A'}\nConnection ID: ${cleanId || 'N/A'}${period}\n\n${message ? `Note: ${message}\n\n` : ''}Please use these details to connect.\n\nBest regards`
      );
      window.open(`mailto:${encodeURIComponent(recipientEmail.trim())}?subject=${subject}&body=${body}`, '_blank');
      toast.success('Email client opened with share details');
    }
    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setConsultantId('');
    setMessage('');
    setAlias('');
    setConnectionId('');
    setStartDate(undefined);
    setEndDate(undefined);
    setRecipientEmail('');
  };

  const toolLabel = toolType === 'anydesk' ? 'AnyDesk' : toolType === 'teamviewer' ? 'TeamViewer' : toolType === 'rustdesk' ? 'RustDesk' : toolType === 'rdp' ? 'RDP/VNC' : toolType;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-4 h-4 text-primary" />
            Share {toolLabel} Config
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={shareMode} onValueChange={(v) => setShareMode(v as 'consultant' | 'email')}>
            <TabsList className="grid w-full grid-cols-2 h-8">
              <TabsTrigger value="consultant" className="text-xs gap-1.5"><Users className="w-3 h-3" /> Consultant</TabsTrigger>
              <TabsTrigger value="email" className="text-xs gap-1.5"><Mail className="w-3 h-3" /> Email Anyone</TabsTrigger>
            </TabsList>

            <TabsContent value="consultant" className="mt-3">
              {loadingConsultants ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading consultants...
                </div>
              ) : !consultants?.length ? (
                <p className="text-xs text-muted-foreground py-2">No consultants assigned to your tickets yet.</p>
              ) : (
                <Select value={consultantId} onValueChange={setConsultantId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Choose a consultant..." />
                  </SelectTrigger>
                  <SelectContent>
                    {consultants.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        <div className="flex items-center gap-2">
                          <Avatar className="w-5 h-5">
                            <AvatarImage src={c.avatar_url || ''} />
                            <AvatarFallback className="text-[8px]">{c.display_name?.[0]}</AvatarFallback>
                          </Avatar>
                          {c.display_name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </TabsContent>

            <TabsContent value="email" className="mt-3">
              <Input
                type="email"
                value={recipientEmail}
                onChange={e => setRecipientEmail(e.target.value)}
                placeholder="recipient@example.com"
                className="h-9 text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Opens your email client with connection details pre-filled.</p>
            </TabsContent>
          </Tabs>

          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Connection Alias</label>
            <Input value={alias} onChange={e => setAlias(e.target.value)} placeholder="e.g. SAP Production Server" className="h-8 text-sm" />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">{toolLabel} ID / Hostname</label>
            <Input value={connectionId} onChange={e => setConnectionId(e.target.value)} placeholder="e.g. 123456789 or 192.168.1.100" className="h-8 text-sm" />
            {connectionId && !isValidConnectionId(toolType, connectionId) && <p className="text-[10px] text-destructive mt-1">{connectionIdHint(toolType)}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Start Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("h-8 w-full justify-start text-xs font-normal", !startDate && "text-muted-foreground")}>
                    <CalendarIcon className="w-3 h-3 mr-1.5" />
                    {startDate ? format(startDate, 'MMM d, yyyy') : 'Pick date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">End Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("h-8 w-full justify-start text-xs font-normal", !endDate && "text-muted-foreground")}>
                    <CalendarIcon className="w-3 h-3 mr-1.5" />
                    {endDate ? format(endDate, 'MMM d, yyyy') : 'Pick date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={endDate} onSelect={setEndDate} disabled={(d) => startDate ? d < startDate : false} initialFocus className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Message (optional)</label>
            <Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Instructions or notes for the consultant..." rows={2} className="text-sm" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleShare}
            disabled={
              !isValidConnectionId(toolType, connectionId) ||
              (shareMode === 'consultant' ? (!consultantId || shareMutation.isPending) : !recipientEmail) 
            }
            className="gradient-primary border-0 gap-1.5"
          >
            {shareMutation.isPending && shareMode === 'consultant' ? <Loader2 className="w-4 h-4 animate-spin" /> : shareMode === 'email' ? <Mail className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            {shareMode === 'email' ? 'Send Email' : 'Share'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}