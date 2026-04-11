import { useState } from 'react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2, Send, CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAvailableConsultants, useShareRemoteConfig } from '@/hooks/useSharedRemoteConfigs';

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

  const handleShare = async () => {
    if (!consultantId) return;
    await shareMutation.mutateAsync({
      consultant_id: consultantId,
      tool_type: toolType,
      config: {
        ...defaultConfig,
        alias,
        connectionId,
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
      },
      message: message || undefined,
    });
    onOpenChange(false);
    setConsultantId('');
    setMessage('');
    setAlias('');
    setConnectionId('');
    setStartDate(undefined);
    setEndDate(undefined);
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
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Select Consultant</label>
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
          </div>

          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Connection Alias</label>
            <Input value={alias} onChange={e => setAlias(e.target.value)} placeholder="e.g. SAP Production Server" className="h-8 text-sm" />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">{toolLabel} ID / Hostname</label>
            <Input value={connectionId} onChange={e => setConnectionId(e.target.value)} placeholder="e.g. 123456789 or 192.168.1.100" className="h-8 text-sm" />
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
            disabled={!consultantId || !connectionId || shareMutation.isPending}
            className="gradient-primary border-0 gap-1.5"
          >
            {shareMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}