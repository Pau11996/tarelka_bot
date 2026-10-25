const listeners = new Set<() => void>();
export function onHealthUpdate(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function healthUpdated() { for (const listener of listeners) listener(); }
