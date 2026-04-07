
ALTER TABLE public.sessions
ADD COLUMN meeting_url text,
ADD COLUMN video_platform text DEFAULT 'jitsi';
