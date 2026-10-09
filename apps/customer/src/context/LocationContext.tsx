import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as Location from 'expo-location';

export interface Coords {
  lat: number;
  lng: number;
}

export type LocationStatus = 'idle' | 'requesting' | 'granted' | 'denied';

interface LocationContextValue {
  /** Null until a request succeeds. Shared across screens once set. */
  coords: Coords | null;
  status: LocationStatus;
  /**
   * Asks for permission and a fix, unless coords are already cached.
   *
   * Resolves when `status`/`coords` have settled — it does NOT return the
   * coords, because a caller reading them synchronously afterwards would race
   * React's state update. Read `coords` from context and react to it instead.
   *
   * Throws only when permission was granted but the position could not be
   * obtained (no GPS fix), so a screen can surface that through its own error
   * state. A refused permission is not an exception — it sets status 'denied'.
   */
  requestLocation: () => Promise<void>;
}

const LocationContext = createContext<LocationContextValue | undefined>(undefined);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');

  // Collapses concurrent callers (Home mounting while Search is pushed) onto a
  // single native round trip instead of two permission dialogs.
  const inFlight = useRef<Promise<void> | null>(null);

  const requestLocation = useCallback(async (): Promise<void> => {
    // Already have a fix — every other screen reuses it, no native call.
    if (coords) return;
    if (inFlight.current) return inFlight.current;

    const run = (async () => {
      setStatus('requesting');
      try {
        // Always re-checks with the OS, so a previous denial can be retried
        // after the user changes the setting.
        const { status: permission } = await Location.requestForegroundPermissionsAsync();
        if (permission !== Location.PermissionStatus.GRANTED) {
          setStatus('denied');
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
        setStatus('granted');
      } catch (err) {
        // Permission is fine but there is no fix (common indoors, and on
        // emulators without a mock location). Not a denial — let the caller
        // render its own error state.
        setStatus('granted');
        throw err;
      } finally {
        inFlight.current = null;
      }
    })();

    inFlight.current = run;
    return run;
  }, [coords]);

  const value = useMemo<LocationContextValue>(
    () => ({ coords, status, requestLocation }),
    [coords, status, requestLocation],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (!ctx) {
    throw new Error('useLocation must be used inside <LocationProvider>');
  }
  return ctx;
}
