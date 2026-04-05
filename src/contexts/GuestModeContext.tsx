import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface GuestModeContextType {
  isGuest: boolean;
  guestRole: 'client' | 'consultant' | 'admin' | null;
  enterGuestMode: (role: 'client' | 'consultant' | 'admin') => void;
  exitGuestMode: () => void;
}

const GuestModeContext = createContext<GuestModeContextType>({
  isGuest: false,
  guestRole: null,
  enterGuestMode: () => {},
  exitGuestMode: () => {},
});

export function GuestModeProvider({ children }: { children: ReactNode }) {
  const [isGuest, setIsGuest] = useState(() => sessionStorage.getItem('guest_mode') === 'true');
  const [guestRole, setGuestRole] = useState<'client' | 'consultant' | 'admin' | null>(
    () => (sessionStorage.getItem('guest_role') as any) || null
  );

  const enterGuestMode = useCallback((role: 'client' | 'consultant' | 'admin') => {
    sessionStorage.setItem('guest_mode', 'true');
    sessionStorage.setItem('guest_role', role);
    setIsGuest(true);
    setGuestRole(role);
  }, []);

  const exitGuestMode = useCallback(() => {
    sessionStorage.removeItem('guest_mode');
    sessionStorage.removeItem('guest_role');
    setIsGuest(false);
    setGuestRole(null);
  }, []);

  return (
    <GuestModeContext.Provider value={{ isGuest, guestRole, enterGuestMode, exitGuestMode }}>
      {children}
    </GuestModeContext.Provider>
  );
}

export const useGuestMode = () => useContext(GuestModeContext);
