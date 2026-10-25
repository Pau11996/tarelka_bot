import { useCallback, useEffect, useRef, useState } from "react";

export function useTransientNotice(duration = 2500) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setMessage(null);
  }, []);

  const show = useCallback((next: string) => {
    if (timer.current !== null) clearTimeout(timer.current);
    setMessage(next);
    timer.current = setTimeout(() => {
      timer.current = null;
      setMessage(null);
    }, duration);
  }, [duration]);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  return { message, show, clear };
}
