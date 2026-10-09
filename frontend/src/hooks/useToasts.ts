import { useState } from 'react';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (kind: Toast['kind'], message: string) => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  };
  return { toasts, push };
}
