import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MessageSquare, X, Send, Loader2, Trash2, Bot, User, Sparkles, Minimize2, TicketPlus,
} from 'lucide-react';
import { useTriageChat } from '@/hooks/useTriageChat';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

function parseTicketSummary(content: string) {
  const titleMatch = content.match(/\*\*Title\*\*:\s*(.+)/i);
  const moduleMatch = content.match(/\*\*SAP Module\*\*:\s*(.+)/i);
  const urgencyMatch = content.match(/\*\*Urgency\*\*:\s*(\w+)/i);
  const descMatch = content.match(/\*\*Description\*\*:\s*(.+)/i);
  if (!titleMatch && !moduleMatch) return null;
  return {
    title: titleMatch?.[1]?.trim() || '',
    module: moduleMatch?.[1]?.trim() || '',
    urgency: urgencyMatch?.[1]?.trim().toLowerCase() || 'medium',
    description: descMatch?.[1]?.trim() || '',
  };
}

export default function AIChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const { messages, isLoading, sendMessage, clearChat } = useTriageChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    sendMessage(text);
  };

  const handleCreateTicket = useCallback((content: string) => {
    const parsed = parseTicketSummary(content);
    if (!parsed) return;
    const params = new URLSearchParams();
    if (parsed.title) params.set('title', parsed.title);
    if (parsed.module) params.set('module', parsed.module);
    if (parsed.urgency) params.set('urgency', parsed.urgency);
    if (parsed.description) params.set('description', parsed.description);
    setIsOpen(false);
    navigate(`/client/new-request?${params.toString()}`);
  }, [navigate]);

  return (
    <>
      {/* FAB */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-20 end-4 sm:bottom-6 sm:end-6 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-xl hover:shadow-2xl hover:scale-105 transition-all flex items-center justify-center group"
        >
          <Sparkles className="w-6 h-6 group-hover:rotate-12 transition-transform" />
        </button>
      )}

      {/* Chat window */}
      {isOpen && (
        <div className="fixed bottom-0 end-0 sm:bottom-6 sm:end-6 z-50 w-full sm:w-[380px] h-[100dvh] sm:h-[560px] sm:rounded-2xl bg-background border border-border/60 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-card/90 backdrop-blur shrink-0">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Qurtuba AI</h3>
              <p className="text-[10px] text-muted-foreground">SAP Ticket Triage Assistant</p>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={clearChat} title="Clear chat">
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsOpen(false)}>
                <X className="w-4 h-4 text-muted-foreground" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {messages.length === 0 && (
              <div className="text-center pt-8 space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                  <Sparkles className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">How can I help?</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Describe your SAP issue and I'll help prepare a support ticket with the right module and urgency.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {[
                    'My SAP FI posting is failing',
                    'MM purchase order stuck',
                    'Basis system performance issue',
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      className="text-[11px] px-3 py-1.5 rounded-full border border-border/50 bg-muted/30 text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  'flex gap-2.5',
                  msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                )}
              >
                <div className={cn(
                  'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                  msg.role === 'user' ? 'bg-primary/10' : 'bg-accent/10'
                )}>
                  {msg.role === 'user' ? (
                    <User className="w-3.5 h-3.5 text-primary" />
                  ) : (
                    <Bot className="w-3.5 h-3.5 text-accent" />
                  )}
                </div>
                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-md'
                      : 'bg-muted/50 text-foreground rounded-tl-md'
                  )}
                >
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>hr]:my-2">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p>{msg.content}</p>
                  )}
                </div>
                {msg.role === 'assistant' && parseTicketSummary(msg.content) && (
                  <div className="flex mt-1.5" style={{ marginInlineStart: '2.375rem' }}>
                    <Button
                      size="sm"
                      className="gap-1.5 h-7 text-xs rounded-lg gradient-primary border-0"
                      onClick={() => handleCreateTicket(msg.content)}
                    >
                      <TicketPlus className="w-3 h-3" />
                      Create Ticket
                    </Button>
                  </div>
                )}

            {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5 text-accent" />
                </div>
                <div className="bg-muted/50 rounded-2xl rounded-tl-md px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-border/40 bg-card/90 backdrop-blur shrink-0">
            <form
              onSubmit={(e) => { e.preventDefault(); handleSend(); }}
              className="flex items-center gap-2"
            >
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Describe your SAP issue..."
                className="flex-1 h-10 rounded-xl text-sm bg-muted/30 border-border/30"
                disabled={isLoading}
              />
              <Button
                type="submit"
                size="icon"
                className="h-10 w-10 rounded-xl bg-primary hover:bg-primary/90 shrink-0"
                disabled={!input.trim() || isLoading}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </form>
            <p className="text-[9px] text-muted-foreground/60 text-center mt-1.5">
              Powered by Qurtuba AI · Responses may be inaccurate
            </p>
          </div>
        </div>
      )}
    </>
  );
}
