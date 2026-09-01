import { useEffect, useRef, useState } from "react";

/** Estado que persiste no localStorage (por chave), sobrevivendo a logout/reload. */
export function usePersistentState<T>(key: string, initial: T) {
  const storageKey = `transitops:pref:${key}`;
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);
  const skipInitialWrite = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw != null) {
        skipInitialWrite.current = true;
        setValue(JSON.parse(raw) as T);
      }
    } catch {
      /* ignore */
    }
    loaded.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (!loaded.current) return;
    if (skipInitialWrite.current) {
      skipInitialWrite.current = false;
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [storageKey, value]);

  return [value, setValue] as const;
}
