// Text of the client's own ticket files for the AI prompt: downloaded with a short-lived link, read in the browser
// (PDF, DOCX, TXT, MD, CSV) and capped; the binary never goes to the AI.
import { supabase } from '@/integrations/supabase/client';
import { extractFileText } from '@/lib/extractFileText';

export async function attachmentTexts(docs: Array<{ id: string; file_name: string; file_url: string }>, ids: string[], maxChars: number): Promise<Array<{ name: string; text: string }>> {
  const out: Array<{ name: string; text: string }> = [];
  for (const d of docs.filter((x) => ids.includes(x.id))) {
    try {
      const { data } = await supabase.storage.from('ticket-documents').createSignedUrl(d.file_url, 60);
      if (!data?.signedUrl) continue;
      const res = await fetch(data.signedUrl);
      if (!res.ok) continue;
      const file = new File([await res.blob()], d.file_name);
      const text = (await extractFileText(file)).slice(0, maxChars);
      if (text.trim()) out.push({ name: d.file_name, text });
    } catch { /* unreadable file: skipped */ }
  }
  return out;
}
