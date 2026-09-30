import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { parseHttpUrl } from '@/lib/safeUrl';

/**
 * Resolves a `messages.file_url` value to a browsable URL. Legacy http(s) values pass through unchanged;
 * storage paths (the current format) are signed for one hour because the `chat-files` bucket is private.
 */
export function useChatFileUrl(fileUrl: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!fileUrl) {
      setUrl(null);
      return;
    }
    if (parseHttpUrl(fileUrl)) {
      setUrl(fileUrl);
      return;
    }
    supabase.storage
      .from('chat-files')
      .createSignedUrl(fileUrl, 3600)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  return url;
}
