// The signed-in person's own voice learning data: learned words, accent group, recording consent
// (voice_my_learning and friends, docs/sql/interview-voice-learning.sql). Returns no data until that file is applied.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { safeRpc } from '@/lib/safeRpc';
import { AUDIO_CONSENT_VERSION } from '../../supabase/functions/_shared/voiceLearning';

export interface MyVoiceTerm { heard: string; term: string; term_key: string; count: number; last_seen: string }
export interface MyVoiceLearning {
  learning: boolean;
  training_audio_offered: boolean;
  retention_days: number;
  consent_version: string;
  consent: { version: string; at: string; current: boolean } | null;
  recordings: number;
  accent: string | null;
  terms: MyVoiceTerm[];
}

const KEY = ['voice', 'my-learning'];

export function useMyVoiceLearning(enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await safeRpc<MyVoiceLearning>('voice_my_learning');
      return error ? null : data;
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  return {
    ...query,
    deleteTerm: async (termKey: string | null) => {
      const { error } = await safeRpc('voice_delete_my_terms', { _term_key: termKey });
      await refresh();
      return !error;
    },
    setAccent: async (accent: string | null) => {
      const { error } = await safeRpc('voice_set_my_accent', { _accent: accent });
      await refresh();
      return !error;
    },
    setConsent: async (granted: boolean, interviewId: string | null) => {
      const { data, error } = await safeRpc<{ ok: boolean; recordings_deleted?: number }>('voice_set_audio_consent', {
        _granted: granted, _version: granted ? AUDIO_CONSENT_VERSION : null, _interview_id: interviewId,
      });
      await refresh();
      return { ok: !error && !!data?.ok, deleted: data?.recordings_deleted ?? 0 };
    },
  };
}
