"use client";

import { useSyncExternalStore } from "react";

export type Theme = "auto" | "paper" | "sepia" | "snow" | "night" | "ink";
export type Pen = "vermilion" | "cobalt" | "moss" | "graphite";
export type Face = "serif" | "book" | "sans" | "legible";
export type Leading = "snug" | "normal" | "airy";
export type Measure = "narrow" | "normal" | "wide";
export type Marker = "yellow" | "green" | "blue" | "pink";
export type AnswerLength = "short" | "normal" | "long";

export interface Settings {
  theme: Theme;
  pen: Pen;
  face: Face;
  size: number;
  leading: Leading;
  width: Measure;
  align: "left" | "justify";
  paras: "spaced" | "indented";
  marker: Marker;
  length: AnswerLength;
  search: boolean;
  numbers: boolean;
  rail: boolean;
  listen: boolean;
  focus: boolean;
  covers: boolean;
  /** Text-to-speech */
  rate: number;
  voice: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "auto",
  pen: "vermilion",
  face: "serif",
  size: 20,
  leading: "normal",
  width: "normal",
  align: "left",
  paras: "spaced",
  marker: "yellow",
  length: "normal",
  search: true,
  numbers: false,
  rail: true,
  listen: false,
  focus: false,
  covers: false,
  rate: 1,
  voice: null,
};

export const SETTINGS_KEY = "gloss:settings";
const LEADING: Record<Leading, number> = { snug: 1.5, normal: 1.64, airy: 1.8 };
const MEASURE: Record<Measure, number> = { narrow: 28, normal: 32, wide: 37 };

let current: Settings = DEFAULT_SETTINGS;
let loaded = false;
const listeners = new Set<() => void>();

function load(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

function ensure() {
  if (!loaded && typeof window !== "undefined") {
    current = load();
    loaded = true;
    applyToDocument(current);
  }
}

/** Resolves "auto" to the system theme. */
export function resolveTheme(theme: Theme): Exclude<Theme, "auto"> {
  if (theme !== "auto") return theme;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) return "night";
  return "paper";
}

export function applyToDocument(s: Settings) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.dataset.theme = resolveTheme(s.theme);
  el.dataset.pen = s.pen;
  el.dataset.face = s.face;
  el.dataset.align = s.align;
  el.dataset.paras = s.paras;
  el.style.setProperty("--read-size", `${s.size}px`);
  el.style.setProperty("--leading", String(LEADING[s.leading]));
  el.style.setProperty("--measure-k", String(MEASURE[s.width]));
}

export function getSettings(): Settings {
  ensure();
  return current;
}

export function setSettings(patch: Partial<Settings>) {
  ensure();
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  applyToDocument(current);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (typeof window !== "undefined") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMq = () => {
      applyToDocument(current);
      cb();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_KEY) {
        current = load();
        applyToDocument(current);
        cb();
      }
    };
    mq.addEventListener("change", onMq);
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      mq.removeEventListener("change", onMq);
      window.removeEventListener("storage", onStorage);
    };
  }
  return () => listeners.delete(cb);
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const s = useSyncExternalStore(subscribe, getSettings, () => DEFAULT_SETTINGS);
  return [s, setSettings];
}

/** Inline script that applies the stored theme before hydration to avoid a flash. */
export const THEME_BOOT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)})||"{}");var d=document.documentElement;var t=s.theme||"auto";if(t==="auto"){t=matchMedia("(prefers-color-scheme: dark)").matches?"night":"paper"}d.dataset.theme=t;d.dataset.pen=s.pen||"vermilion";d.dataset.face=s.face||"serif";d.dataset.align=s.align||"left";d.dataset.paras=s.paras||"spaced";if(s.size)d.style.setProperty("--read-size",s.size+"px");var L={snug:1.5,normal:1.64,airy:1.8},M={narrow:28,normal:32,wide:37};if(s.leading)d.style.setProperty("--leading",L[s.leading]||1.64);if(s.width)d.style.setProperty("--measure-k",M[s.width]||32);}catch(e){}})();`;
