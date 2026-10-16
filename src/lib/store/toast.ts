"use client";

import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; onClick: () => void };
  ttl?: number;
}

let toasts: Toast[] = [];
let n = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, opts: Omit<Toast, "id" | "text"> = {}) {
  const t: Toast = { id: ++n, text, ttl: 4200, ...opts };
  toasts = [...toasts.filter((x) => x.text !== text), t];
  emit();
  if (t.ttl) window.setTimeout(() => dismissToast(t.id), t.ttl);
  return t.id;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
    () => toasts,
  );
}
