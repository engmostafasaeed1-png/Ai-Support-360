import { useEffect, useRef, useState } from 'react';
import { useMyLocation } from '@/hooks/useMyLocation';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { clearSignupLocation, pendingSignupLocation } from '@/lib/signupLocation';
import LocationDialog from './LocationDialog';

const shownKey = (userId: string) => `location_prompt_shown:${userId}`;

/**
 * Mounted once in the consultant portal. A location chosen at sign-up (email or Google) is saved on the first visit;
 * otherwise a consultant without a location sees the "Add your location" dialog once per sign-in session.
 */
export default function LocationGate() {
  const { isGuest } = useGuestMode();
  const { loading, data, has, isConsultant, save } = useMyLocation();
  const [open, setOpen] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    if (isGuest || loading || !data || !isConsultant || has || handled.current) return;
    handled.current = true;
    const pending = pendingSignupLocation(data.metadata);
    if (pending) {
      void save(pending.country, pending.city).then(clearSignupLocation, () => setOpen(true));
      return;
    }
    try {
      if (sessionStorage.getItem(shownKey(data.userId))) return;
      sessionStorage.setItem(shownKey(data.userId), '1');
    } catch { /* storage unavailable: still show once for this page */ }
    setOpen(true);
  }, [isGuest, loading, data, isConsultant, has, save]);

  if (!data || has) return null;
  return <LocationDialog open={open} onOpenChange={setOpen} initial={{ country: data.country, city: data.city }} onSave={save} />;
}
