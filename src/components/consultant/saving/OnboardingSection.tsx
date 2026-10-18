import type { ReactNode } from 'react';
import { useSectionAutosave } from '@/hooks/useSectionAutosave';
import { useProfileSavePrompt } from './ProfileImportance';
import SectionSaveControls from './SectionSaveControls';
export default function OnboardingSection({ values, automatic, persist, validate, disabled, children, sourceRevision }: {
  sourceRevision: number; values: Record<string, unknown>; automatic: boolean; persist: (patch: Record<string, unknown>) => Promise<void>;
  validate: (patch: Record<string, unknown>) => string | null; disabled: boolean; children: ReactNode;
}) {
  const beforeManual = useProfileSavePrompt();
  const state = useSectionAutosave({ values, sourceRevision, ready: !disabled, automatic, persist, validate, beforeManual });
  return <div className="space-y-3" onBlur={event => {
    const next = event.relatedTarget;
    if (next instanceof Node && !event.currentTarget.contains(next) && automatic) void state.flush();
  }}>
    <SectionSaveControls state={state} disabled={disabled} />
    {children}
  </div>;
}
