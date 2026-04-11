import { useState, useRef, useEffect, useCallback } from 'react';
import SafeMarkdown from '@/components/ui/SafeMarkdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  X, Send, Loader2, Trash2, Bot, User, Sparkles, TicketPlus,
  History, Plus, ChevronLeft, Pencil, Check, Zap,
} from 'lucide-react';
import { useTriageChat } from '@/hooks/useTriageChat';
import { useNavigate, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import AIModelSelector, { DEFAULT_MODEL, type AIModelId } from '@/components/ai/AIModelSelector';

const AUTO_OPEN_DELAY = 4000;
const AUTO_OPEN_DONE_KEY = "qt-chat-auto-opened";
const IDLE_TIMEOUT = 90_000;
const WARNING_DURATION = 20_000;

const QUICK_PROMPTS = [
  { label: "🔧 SAP Basis Issue", prompt: "I have an SAP Basis issue, can you help me triage it?" },
  { label: "📊 FI/CO Question", prompt: "I need help with an SAP FI/CO configuration question" },
  { label: "🛒 MM Problem", prompt: "I'm having a problem with SAP MM procurement" },
  { label: "🚀 Get Started", prompt: "I'm new here — what can AI SAP Support Now help me with?" },
];

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
  const [showHistory, setShowHistory] = useState(false);
  const [selectedModel, setSelectedModel] = useState<AIModelId>(DEFAULT_MODEL);
  const [showPulse, setShowPulse] = useState(false);
  const [closingWarning, setClosingWarning] = useState(false);
  const [closingCountdown, setClosingCountdown] = useState(20);
  const {
    messages, isLoading, sendMessage, clearChat,
    conversations, conversationId, loadConversation,
    deleteConversation, renameConversation, newChat, userId,
  } = useTriageChat();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasAutoOpened = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const chatIdleRef = useRef<ReturnType<typeof setTimeout>>();
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const countdownRef = useRef<ReturnType<typeof setInterval>>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const isPublicPage = ['/', '/login', '/signup', '/forgot-password', '/reset-password', '/pricing'].includes(location.pathname);

  // Reset inactivity timer
  const resetChatIdle = useCallback(() => {
    setClosingWarning(false);
    setClosingCountdown(20);
    clearTimeout(chatIdleRef.current);
    clearTimeout(closeTimerRef.current);
    clearInterval(countdownRef.current);

    if (!isOpen) return;

    chatIdleRef.current = setTimeout(() => {
      setClosingWarning(true);
      setClosingCountdown(20);
      let count = 20;
      countdownRef.current = setInterval(() => {
        count -= 1;
        setClosingCountdown(count);
        if (count <= 0) clearInterval(countdownRef.current);
      }, 1000);
      closeTimerRef.current = setTimeout(() => {
        setIsOpen(false);
        setClosingWarning(false);
        setShowPulse(true);
        clearInterval(countdownRef.current);
      }, WARNING_DURATION);
    }, IDLE_TIMEOUT);
  }, [isOpen]);

  // Start/reset idle timer when chat opens or messages change
  useEffect(() => {
    if (isOpen) {
      resetChatIdle();
    } else {
      clearTimeout(chatIdleRef.current);
      clearTimeout(closeTimerRef.current);
      clearInterval(countdownRef.current);
      setClosingWarning(false);
    }
    return () => {
      clearTimeout(chatIdleRef.current);
      clearTimeout(closeTimerRef.current);
      clearInterval(countdownRef.current);
    };
  }, [isOpen, messages.length, resetChatIdle]);

  // Auto-open after idle (once per session)
  useEffect(() => {
    if (isPublicPage) return;
    if (sessionStorage.getItem(AUTO_OPEN_DONE_KEY)) return;
    const resetTimer = () => {
      if (hasAutoOpened.current) return;
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        if (!hasAutoOpened.current) {
          hasAutoOpened.current = true;
          sessionStorage.setItem(AUTO_OPEN_DONE_KEY, "1");
          setShowPulse(true);
        }
      }, AUTO_OPEN_DELAY);
    };
    const events = ["mousedown", "mousemove", "keydown", "touchstart", "scroll"];
    resetTimer();
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    return () => {
      clearTimeout(idleTimerRef.current);
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, []);

  // Periodic pulse when closed
  useEffect(() => {
    if (isPublicPage) return;
    const interval = setInterval(() => {
      if (!isOpen) setShowPulse(true);
    }, 60_000);
    return () => clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, closingWarning]);

  useEffect(() => {
    if (isOpen && !showHistory) inputRef.current?.focus();
    if (isOpen) setShowPulse(false);
  }, [isOpen, showHistory]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    resetChatIdle();
    sendMessage(text, selectedModel);
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

  const handleLoadConversation = (id: string) => {
    loadConversation(id);
    setShowHistory(false);
  };

  return (
    <>
      {/* Floating button with pulse */}
      {!isOpen && (
        <div className="fixed bottom-20 end-4 sm:bottom-6 sm:end-6 z-50 flex items-end gap-2">
          {/* Speech bubble */}
          {showPulse && (
            <div
              className="bg-card/95 backdrop-blur-xl border border-border/50 rounded-2xl rounded-br-md px-4 py-2.5 shadow-xl max-w-[200px] cursor-pointer animate-fade-in"
              onClick={() => { setIsOpen(true); setShowPulse(false); }}
            >
              <p className="text-xs font-semibold text-foreground leading-tight">👋 {t('chatbot.greeting', 'Need help?')}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t('chatbot.greeting_sub', 'Ask me about SAP issues')}</p>
            </div>
          )}
          <button
            onClick={() => { setIsOpen(true); setShowPulse(false); }}
            aria-label="Open AI support chat"
            className="relative w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-xl hover:shadow-2xl hover:scale-105 transition-all flex items-center justify-center group"
          >
            <Sparkles className="w-6 h-6 group-hover:rotate-12 transition-transform" />
            {showPulse && (
              <>
                <span className="absolute inset-0 rounded-full border-2 border-primary/40 animate-ping pointer-events-none" />
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-destructive border-2 border-background animate-bounce" />
              </>
            )}
          </button>
        </div>
      )}

      {isOpen && (
        <div
          role="dialog"
          aria-label="AI Support Chat"
          aria-modal="true"
      className="fixed bottom-0 end-0 sm:bottom-6 sm:end-6 z-50 w-full sm:w-[380px] h-[100dvh] sm:h-[560px] sm:rounded-2xl bg-background border border-border/60 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
          onMouseMove={resetChatIdle}
          onClick={resetChatIdle}
          onKeyDown={(e) => { if (e.key === 'Escape') setIsOpen(false); }}
        >
          {/* Header */}
          <div className="relative flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-card/90 backdrop-blur shrink-0">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/[0.06] via-primary/[0.03] to-transparent" />
            {showHistory ? (
              <>
                <Button variant="ghost" size="icon" className="relative h-8 w-8" onClick={() => setShowHistory(false)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <h3 className="relative text-sm font-semibold text-foreground flex-1">{t('chatbot.history_title')}</h3>
              </>
            ) : (
              <>
                <div className="relative w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-primary" />
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary border-2 border-card" />
                </div>
                <div className="relative flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{t('chatbot.title')}</h3>
                  <div className="flex items-center gap-1">
                    <Zap className="w-2.5 h-2.5 text-primary" />
                    <p className="text-[10px] text-primary font-medium">{t('chatbot.online', 'Online • Ready to help')}</p>
                  </div>
                </div>
              </>
            )}
            <div className="relative flex items-center gap-1">
              {!showHistory && userId && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowHistory(true)} title="Chat history">
                  <History className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              )}
              {!showHistory && messages.length > 0 && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={newChat} title="New chat">
                  <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              )}
              {!showHistory && messages.length > 0 && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={clearChat} title="Clear chat">
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Close chat" onClick={() => { setIsOpen(false); setShowHistory(false); }}>
                <X className="w-4 h-4 text-muted-foreground" />
              </Button>
            </div>
          </div>

          {/* Closing warning */}
          {closingWarning && (
            <div className="flex items-center justify-between px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-xs">
              <span className="text-destructive font-medium">
                Closing in {closingCountdown}s due to inactivity
              </span>
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={resetChatIdle}>
                Stay open
              </Button>
            </div>
          )}

          {/* History panel */}
          {showHistory ? (
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {conversations.length === 0 ? (
                <div className="text-center pt-12">
                  <History className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">{t('chatbot.no_history')}</p>
                </div>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={cn(
                      'flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all hover:bg-muted/50',
                      conversationId === conv.id ? 'border-primary/30 bg-primary/5' : 'border-border/40'
                    )}
                  >
                    {editingId === conv.id ? (
                      <form
                        className="flex-1 min-w-0 flex items-center gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          renameConversation(conv.id, editTitle);
                          setEditingId(null);
                        }}
                      >
                        <Input
                          autoFocus
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="h-7 text-sm px-2"
                          onBlur={() => { renameConversation(conv.id, editTitle); setEditingId(null); }}
                          onKeyDown={(e) => { if (e.key === 'Escape') setEditingId(null); }}
                        />
                        <Button type="submit" variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                          <Check className="w-3 h-3 text-primary" />
                        </Button>
                      </form>
                    ) : (
                      <button className="flex-1 min-w-0 text-start" onClick={() => handleLoadConversation(conv.id)}>
                        <p className="text-sm font-medium text-foreground truncate">{conv.title}</p>
                        <p className="text-[10px] text-muted-foreground">{new Date(conv.updated_at).toLocaleDateString()}</p>
                      </button>
                    )}
                    {editingId !== conv.id && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                        onClick={(e) => { e.stopPropagation(); setEditingId(conv.id); setEditTitle(conv.title); }}>
                        <Pencil className="w-3 h-3 text-muted-foreground" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                      onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}>
                      <Trash2 className="w-3 h-3 text-muted-foreground" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              {/* Messages */}
              <div ref={scrollRef} aria-live="polite" aria-atomic="false" className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {messages.length === 0 && (
                  <div className="text-center pt-8 space-y-4">
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                      <Sparkles className="w-8 h-8 text-primary" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">{t('chatbot.how_can_i_help')}</h4>
                      <p className="text-xs text-muted-foreground mt-1">{t('chatbot.description')}</p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      {QUICK_PROMPTS.map((qp) => (
                        <button
                          key={qp.label}
                          onClick={() => { resetChatIdle(); sendMessage(qp.prompt, selectedModel); }}
                          disabled={isLoading}
                          className="text-[11px] px-3 py-1.5 rounded-full border border-primary/20 bg-primary/[0.06] text-primary hover:bg-primary/[0.12] hover:border-primary/30 transition-all duration-200 hover:shadow-sm disabled:opacity-50"
                        >
                          {qp.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} className="space-y-1.5 animate-fade-in">
                    <div className={cn('flex gap-2.5', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
                      <div className={cn(
                        'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                        msg.role === 'user' ? 'bg-primary/10' : 'bg-accent/10'
                      )}>
                        {msg.role === 'user' ? <User className="w-3.5 h-3.5 text-primary" /> : <Bot className="w-3.5 h-3.5 text-accent" />}
                      </div>
                      <div className={cn(
                        'max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm',
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground rounded-tr-md'
                          : 'bg-muted/50 text-foreground rounded-tl-md'
                      )}>
                        {msg.role === 'assistant' ? (
                          <div className={cn(
                            "prose prose-sm dark:prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>hr]:my-2",
                            isLoading && i === messages.length - 1 && "chatbot-streaming"
                          )}>
                            <SafeMarkdown content={msg.content} />
                          </div>
                        ) : (
                          <p>{msg.content}</p>
                        )}
                      </div>
                    </div>
                    {msg.role === 'assistant' && parseTicketSummary(msg.content) && (
                      <div className="flex" style={{ paddingInlineStart: '2.375rem' }}>
                        <Button
                          size="sm"
                          className="gap-1.5 h-7 text-xs rounded-lg"
                          onClick={() => handleCreateTicket(msg.content)}
                        >
                          <TicketPlus className="w-3 h-3" />
                          {t('chatbot.create_ticket')}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}

                {/* Continue / More Detail buttons */}
                {!isLoading && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && (
                  <div className="flex gap-2 ps-9">
                    <button
                      onClick={() => { resetChatIdle(); sendMessage("Continue", selectedModel); }}
                      className="px-4 py-2 text-xs font-semibold rounded-full bg-primary text-primary-foreground shadow-md hover:shadow-lg transition-all duration-200 hover:scale-[1.03] active:scale-95"
                    >
                      ➡️ Continue
                    </button>
                    <button
                      onClick={() => { resetChatIdle(); sendMessage("Can you explain that in more detail?", selectedModel); }}
                      className="px-3 py-2 text-xs font-medium rounded-full border border-border/50 bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-200"
                    >
                      🔍 More Detail
                    </button>
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
                <div className="flex items-center justify-between mb-2">
                  <AIModelSelector value={selectedModel} onChange={setSelectedModel} compact />
                </div>
                <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2">
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => { setInput(e.target.value); resetChatIdle(); }}
                    placeholder={t('chatbot.placeholder')}
                    aria-label="Type your message"
                    className="flex-1 h-10 rounded-xl text-sm bg-muted/30 border-border/30"
                    disabled={isLoading}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    aria-label="Send message"
                    className="h-10 w-10 rounded-xl bg-primary hover:bg-primary/90 shrink-0"
                    disabled={!input.trim() || isLoading}
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </form>
                <p className="text-[9px] text-muted-foreground/60 text-center mt-1.5">{t('chatbot.powered_by')}</p>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
