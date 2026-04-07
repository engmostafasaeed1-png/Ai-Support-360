import { useState } from 'react';
import { useTasks, TaskStatus, TaskPriority, Task } from '@/hooks/useTasks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Calendar, CheckCircle2, Circle, Clock, Eye, GripVertical, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

const COLUMNS: { status: TaskStatus; label: string; icon: React.ReactNode; color: string }[] = [
  { status: 'todo', label: 'To Do', icon: <Circle className="h-4 w-4" />, color: 'border-t-muted-foreground' },
  { status: 'in_progress', label: 'In Progress', icon: <Clock className="h-4 w-4" />, color: 'border-t-blue-500' },
  { status: 'in_review', label: 'In Review', icon: <Eye className="h-4 w-4" />, color: 'border-t-amber-500' },
  { status: 'done', label: 'Done', icon: <CheckCircle2 className="h-4 w-4" />, color: 'border-t-emerald-500' },
];

const priorityConfig: Record<TaskPriority, { label: string; class: string }> = {
  low: { label: 'Low', class: 'bg-muted text-muted-foreground' },
  medium: { label: 'Medium', class: 'bg-blue-500/10 text-blue-600' },
  high: { label: 'High', class: 'bg-amber-500/10 text-amber-600' },
  urgent: { label: 'Urgent', class: 'bg-destructive/10 text-destructive' },
};

function TaskCard({ task, onUpdate, onDelete }: { task: Task; onUpdate: (updates: Partial<Task> & { id: string }) => void; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const p = priorityConfig[task.priority];

  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow border-border/50">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium text-sm leading-tight flex-1">{task.title}</p>
          <Badge variant="outline" className={`text-[10px] shrink-0 ${p.class}`}>{p.label}</Badge>
        </div>
        {task.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
        )}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 flex-wrap">
            {task.tags?.map(tag => (
              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">{tag}</Badge>
            ))}
          </div>
          {task.due_date && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {format(new Date(task.due_date), 'MMM d')}
            </span>
          )}
        </div>
        <div className="flex gap-1 pt-1">
          {COLUMNS.filter(c => c.status !== task.status).map(col => (
            <Button
              key={col.status}
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={(e) => { e.stopPropagation(); onUpdate({ id: task.id, status: col.status }); }}
            >
              {col.icon}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-2 ml-auto text-destructive hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateTaskDialog({ onSubmit }: { onSubmit: (task: { title: string; description?: string; priority: TaskPriority; due_date?: string; tags?: string[] }) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      due_date: dueDate || undefined,
      tags: tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : undefined,
    });
    setTitle(''); setDescription(''); setPriority('medium'); setDueDate(''); setTagsInput('');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> New Task
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Task title..." value={title} onChange={e => setTitle(e.target.value)} />
          <Textarea placeholder="Description (optional)..." value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          <div className="grid grid-cols-2 gap-3">
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <Input placeholder="Tags (comma separated)" value={tagsInput} onChange={e => setTagsInput(e.target.value)} />
          <Button onClick={handleSubmit} className="w-full" disabled={!title.trim()}>Create Task</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function TaskBoardPage() {
  const { tasks, isLoading, createTask, updateTask, deleteTask, tasksByStatus } = useTasks();

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Task Board</h1>
          <p className="text-sm text-muted-foreground">{tasks.length} total tasks</p>
        </div>
        <CreateTaskDialog onSubmit={(t) => createTask.mutate(t)} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {COLUMNS.map(col => {
          const count = tasksByStatus(col.status).length;
          return (
            <Card key={col.status} className={`border-t-2 ${col.color}`}>
              <CardContent className="p-3 flex items-center gap-2">
                {col.icon}
                <div>
                  <p className="text-lg font-bold">{count}</p>
                  <p className="text-xs text-muted-foreground">{col.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {COLUMNS.map(col => (
          <div key={col.status} className="space-y-3">
            <div className={`flex items-center gap-2 pb-2 border-b-2 ${col.color.replace('border-t-', 'border-b-')}`}>
              {col.icon}
              <span className="font-semibold text-sm">{col.label}</span>
              <Badge variant="secondary" className="ml-auto text-xs">{tasksByStatus(col.status).length}</Badge>
            </div>
            <div className="space-y-2 min-h-[100px]">
              {tasksByStatus(col.status).map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onUpdate={(updates) => updateTask.mutate(updates)}
                  onDelete={(id) => deleteTask.mutate(id)}
                />
              ))}
              {tasksByStatus(col.status).length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-xs border border-dashed rounded-lg">
                  No tasks
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
