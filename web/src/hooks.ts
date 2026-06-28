import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * useState mirrored to localStorage. `decode` parses the stored string; any
 * storage/parse failure falls back. Accepts a value or updater like useState,
 * and persists the resulting value.
 */
export function usePersistedState<T>(
  key: string,
  fallback: T,
  decode: (raw: string) => T,
  encode: (v: T) => string = String,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : decode(raw);
    } catch {
      return fallback;
    }
  });
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (action) =>
      setValue((prev) => {
        const next = typeof action === "function" ? (action as (p: T) => T)(prev) : action;
        try {
          localStorage.setItem(key, encode(next));
        } catch {
          /* storage may be unavailable */
        }
        return next;
      }),
    [key, encode],
  );
  return [value, set];
}

/**
 * Two-step confirm. The first `trigger(action)` arms (and returns); a second call
 * within `ms` runs `action`; otherwise it disarms. `armed` drives the button label.
 */
export function useConfirm(ms = 3000): [boolean, (action: () => void) => void] {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const trigger = useCallback(
    (action: () => void) => {
      clearTimeout(timer.current);
      if (armed) {
        setArmed(false);
        action();
        return;
      }
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), ms);
    },
    [armed, ms],
  );
  return [armed, trigger];
}
