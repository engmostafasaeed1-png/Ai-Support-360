import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  FileText, Upload, Download, Trash2, History, MessageSquare, File,
  FileImage, FileSpreadsheet, FileCode, FileArchive,
} from 'lucide-react';
import { useTicketDocuments, useUploadTicketDocument, useDeleteTicketDocument, type TicketDocument } from '@/hooks/useTicketDocuments';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { openExternal } from '@/lib/safeUrl';

const fileIcons: Record<string, typeof FileText> = {
  'application/pdf': FileText,
  'image/': FileImage,
  'text/csv': FileSpreadsheet,
  'application/vnd.ms-excel': FileSpreadsheet,
  'application/vnd.openxmlformats': FileSpreadsheet,
  'text/': FileCode,
  'application/zip': FileArchive,
  'application/x-rar': FileArchive,
};

function getFileIcon(mimeType: string | null) {
  if (!mimeType) return File;
  for (const [key, icon] of Object.entries(fileIcons)) {
    if (mimeType.startsWith(key)) return icon;
  }
  return File;
}

function formatFileSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TicketDocuments({ ticketId }: { ticketId: string }) {
  const { data: docs, isLoading } = useTicketDocuments(ticketId);
  const uploadMutation = useUploadTicketDocument(ticketId);
  const deleteMutation = useDeleteTicketDocument(ticketId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [comment, setComment] = useState('');
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const ALLOWED_TYPES = [
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg', 'image/png', 'image/gif', 'text/plain', 'text/csv',
  ];
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const DANGEROUS_EXTS = ['exe', 'bat', 'cmd', 'sh', 'php', 'js', 'html', 'htm', 'svg', 'xml'];

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) return `File type not allowed: ${file.type}`;
    if (file.size > MAX_FILE_SIZE) return `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max 10MB.`;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext && DANGEROUS_EXTS.includes(ext)) return `File extension .${ext} is not permitted.`;
    return null;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const error = validateFile(file);
    if (error) { toast.error(error); if (fileInputRef.current) fileInputRef.current.value = ''; return; }
    await uploadMutation.mutateAsync({ file, comment: comment.trim() || undefined });
    setComment('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownload = async (doc: TicketDocument) => {
    const { data } = await supabase.storage.from('ticket-documents').createSignedUrl(doc.file_url, 60);
    if (data?.signedUrl) {
      openExternal(data.signedUrl);
    }
  };

  // Group docs by file_name to show version history
  const grouped = (docs || []).reduce((acc, doc) => {
    if (!acc[doc.file_name]) acc[doc.file_name] = [];
    acc[doc.file_name].push(doc);
    return acc;
  }, {} as Record<string, TicketDocument[]>);

  if (isLoading) {
    return <Skeleton className="h-48 rounded-2xl" />;
  }

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" /> Documents
          <Badge variant="secondary" className="text-[10px]">{docs?.length || 0} files</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload area */}
        <div className="p-4 rounded-xl border-2 border-dashed border-border/50 bg-muted/20 space-y-3">
          <div className="flex items-center gap-3">
            <Input
              placeholder="Add a comment (optional)..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="flex-1 h-9 text-sm"
            />
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleUpload}
            />
            <Button
              size="sm"
              className="gradient-primary border-0 gap-1.5"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
            >
              <Upload className="w-3.5 h-3.5" />
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Upload a new file or a new version of an existing file. Max 20MB.
          </p>
        </div>

        {/* File list */}
        {Object.keys(grouped).length === 0 ? (
          <div className="py-8 text-center">
            <File className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No documents uploaded yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {Object.entries(grouped).map(([fileName, versions]) => {
              const latest = versions[0];
              const Icon = getFileIcon(latest.mime_type);
              const hasHistory = versions.length > 1;
              const isExpanded = expandedFile === fileName;

              return (
                <div key={fileName} className="rounded-xl border border-border/30 bg-muted/10 overflow-hidden">
                  {/* Latest version row */}
                  <div className="flex items-center gap-3 p-3 hover:bg-muted/20 transition-colors">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{fileName}</p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>v{latest.version}</span>
                        <span>·</span>
                        <span>{latest.uploader_name}</span>
                        <span>·</span>
                        <span>{formatDistanceToNow(new Date(latest.created_at), { addSuffix: true })}</span>
                        {latest.file_size && (
                          <>
                            <span>·</span>
                            <span>{formatFileSize(latest.file_size)}</span>
                          </>
                        )}
                      </div>
                      {latest.comment && (
                        <p className="text-[11px] text-muted-foreground/70 mt-0.5 flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" /> {latest.comment}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {hasHistory && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setExpandedFile(isExpanded ? null : fileName)}
                        >
                          <History className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(latest)}>
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => deleteMutation.mutate(latest)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Version history */}
                  {isExpanded && hasHistory && (
                    <div className="border-t border-border/20 bg-muted/5">
                      {versions.slice(1).map((v) => {
                        const VIcon = getFileIcon(v.mime_type);
                        return (
                          <div key={v.id} className="flex items-center gap-3 px-3 py-2 ps-12 text-xs">
                            <VIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="text-muted-foreground">v{v.version}</span>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-muted-foreground">{v.uploader_name}</span>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-muted-foreground">{formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}</span>
                            {v.comment && (
                              <span className="text-muted-foreground/60 truncate flex-1">{v.comment}</span>
                            )}
                            <Button variant="ghost" size="icon" className="h-6 w-6 ms-auto" onClick={() => handleDownload(v)}>
                              <Download className="w-3 h-3" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
