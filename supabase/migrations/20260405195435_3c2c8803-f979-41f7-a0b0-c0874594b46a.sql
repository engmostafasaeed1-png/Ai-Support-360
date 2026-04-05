
-- Table for chatbot conversations
CREATE TABLE public.chatbot_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  title text DEFAULT 'New conversation',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Table for chatbot messages
CREATE TABLE public.chatbot_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.chatbot_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.chatbot_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatbot_messages ENABLE ROW LEVEL SECURITY;

-- Conversation policies
CREATE POLICY "Users can view own conversations"
  ON public.chatbot_conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own conversations"
  ON public.chatbot_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations"
  ON public.chatbot_conversations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversations"
  ON public.chatbot_conversations FOR DELETE
  USING (auth.uid() = user_id);

-- Message policies
CREATE POLICY "Users can view own conversation messages"
  ON public.chatbot_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.chatbot_conversations c
    WHERE c.id = chatbot_messages.conversation_id AND c.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert own conversation messages"
  ON public.chatbot_messages FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.chatbot_conversations c
    WHERE c.id = chatbot_messages.conversation_id AND c.user_id = auth.uid()
  ));

-- Indexes
CREATE INDEX idx_chatbot_conversations_user ON public.chatbot_conversations(user_id);
CREATE INDEX idx_chatbot_messages_conversation ON public.chatbot_messages(conversation_id);

-- Updated_at trigger
CREATE TRIGGER update_chatbot_conversations_updated_at
  BEFORE UPDATE ON public.chatbot_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
