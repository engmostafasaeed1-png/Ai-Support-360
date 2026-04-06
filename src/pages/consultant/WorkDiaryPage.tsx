import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useConsultantWorkDiary, useCreateDiaryEntry } from '@/hooks/useWorkDiary';
import { Clock, Plus, Activity, Monitor, PenLine, Calendar } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

function getActivityColor(level: number) {
  if (level >= 80) return 'bg-green-500';
  if (level >= 50) return 'bg-yellow-500';
  if (level >= 20) return 'bg-orange-500';
  return 'bg-muted';
}

function formatDuration(start: string, end: string | null) {
  if (!end) return 'In progress';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

function groupByDate(entries: any[]) {
  const groups: Record<string, any[]> = {};
  entries.forEach(e => {
    const date = new Date(e.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    if (!groups[date]) groups[date] = [];
    groups[date].push(e);
  });
  return groups;
}

export default function WorkDiaryPage() {
  const { data: entries, isLoading } = useConsultantWorkDiary();
  const createEntry = useCreateDiaryEntry();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ start_time: '', end_time: '', memo: '' });

  const grouped = groupByDate(entries || []);
  const totalHours = (entries || []).reduce((sum: number, e: any) => {
    if (!e.end_time) return sum;
    return sum + (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 3600000;
  }, 0);
  const avgActivity = (entries || []).filter((e: any) => !e.is_manual).reduce((s: number, e: any, _: number, a: any[]) => s + (e.activity_level || 0) / a.length, 0);

  const handleSubmit = () => {
    if (!form.start_time || !form.end_time || !form.memo) {
      toast.error('Please fill all fields');
      return;
    }
    createEntry.mutate(
      { start_time: new Date(form.start_time).toISOString(), end_time: new Date(form.end_time).toISOString(), memo: form.memo, is_manual: true },
      {
        onSuccess: () => { toast.success('Time entry added'); setOpen(false); setForm({ start_time: '', end_time: '', memo: '' }); },
        onError: () => toast.error('Failed to add entry'),
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Work Diary</h1>
          <p className="text-sm text-muted-foreground mt-1">Track your working hours and activity</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gradient-primary border-0 gap-1.5">
              <Plus className="w-4 h-4" /> Add Manual Time
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Manual Time Entry</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Start Time</label>
                  <Input type="datetime-local" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">End Time</label>
                  <Input type="datetime-local" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">What did you work on?</label>
                <Textarea value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="Describe your work..." />
              </div>
              <Button onClick={handleSubmit} disabled={createEntry.isPending} className="w-full gradient-primary border-0">
                {createEntry.isPending ? 'Saving...' : 'Save Entry'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <Clock className="w-5 h-5 text-accent mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{totalHours.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">Total Hours</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <Activity className="w-5 h-5 text-green-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{Math.round(avgActivity)}%</p>
            <p className="text-xs text-muted-foreground">Avg Activity</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <Calendar className="w-5 h-5 text-primary mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{(entries || []).length}</p>
            <p className="text-xs text-muted-foreground">Entries</p>
          </CardContent>
        </Card>
      </div>

      {/* Timeline */}
      {isLoading ? (
        [1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)
      ) : Object.keys(grouped).length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="py-12 text-center text-muted-foreground">No work diary entries yet.</CardContent></Card>
      ) : (
        Object.entries(grouped).map(([date, dayEntries]) => {
          const dayTotal = dayEntries.reduce((s: number, e: any) => {
            if (!e.end_time) return s;
            return s + (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 3600000;
          }, 0);
          return (
            <div key={date} className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{date}</h3>
                <Badge variant="secondary" className="text-[10px]">{dayTotal.toFixed(1)}h total</Badge>
              </div>
              {dayEntries.map((entry: any) => (
                <Card key={entry.id} className="rounded-2xl border-border/50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <div className={`w-3 h-3 rounded-full ${entry.is_manual ? 'bg-muted border-2 border-primary' : getActivityColor(entry.activity_level)}`} />
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(entry.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{entry.memo || 'No description'}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {formatDuration(entry.start_time, entry.end_time)}
                          </span>
                          {!entry.is_manual && (
                            <span className="flex items-center gap-1">
                              <Activity className="w-3 h-3" /> {entry.activity_level}% activity
                            </span>
                          )}
                          {entry.is_manual && (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <PenLine className="w-2.5 h-2.5" /> Manual
                            </Badge>
                          )}
                          {entry.screenshot_url && (
                            <span className="flex items-center gap-1 text-accent">
                              <Monitor className="w-3 h-3" /> Screenshot
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
