import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Maximize2, Minimize2, Monitor, ExternalLink } from 'lucide-react';

interface GuacamoleViewerProps {
  url: string;
  name: string;
  osType?: string | null;
}

export default function GuacamoleViewer({ url, name, osType }: GuacamoleViewerProps) {
  const [fullscreen, setFullscreen] = useState(false);

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-border">
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm text-foreground">{name}</span>
            {osType && <Badge variant="secondary" className="text-[10px]">{osType}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => window.open(url, '_blank')}>
              <ExternalLink className="w-3 h-3 me-1" /> Pop Out
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFullscreen(false)}>
              <Minimize2 className="w-3 h-3 me-1" /> Exit Fullscreen
            </Button>
          </div>
        </div>
        <iframe
          src={url}
          className="w-full border-0"
          style={{ height: 'calc(100vh - 48px)' }}
          allow="clipboard-read; clipboard-write"
          title={`Remote Desktop - ${name}`}
        />
      </div>
    );
  }

  return (
    <Card className="rounded-2xl border-border/50 overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Monitor className="w-4 h-4 text-primary" /> {name}
            {osType && <Badge variant="secondary" className="text-[10px]">{osType}</Badge>}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => window.open(url, '_blank')}>
              <ExternalLink className="w-3 h-3 me-1" /> Pop Out
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFullscreen(true)}>
              <Maximize2 className="w-3 h-3 me-1" /> Fullscreen
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <iframe
          src={url}
          className="w-full border-0 rounded-b-2xl"
          style={{ height: '500px' }}
          allow="clipboard-read; clipboard-write"
          title={`Remote Desktop - ${name}`}
        />
      </CardContent>
    </Card>
  );
}
