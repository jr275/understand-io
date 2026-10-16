"use client";

import { useSyncExternalStore } from "react";
import type { Annotation, Gloss, GlossDocument, ReadingProgress } from "@/lib/content/types";

/**
 * Local-first store. Everything is kept in localStorage under `gloss:v1` so the app works
 * with no backend; when the server persists (DATABASE_URL set) the same operations are mirrored
 * through the API and the server copy is merged back on load.
 */
export interface LibraryState {
  /** Document metadata (and blocks for documents that only exist locally). */
  docs: Record<string, GlossDocument>;
  progress: Record<string, ReadingProgress>;
  annotations: Record<string, Annotation[]>;
  glosses: Record<string, Gloss[]>;
  /** Server-side document list (metadata only), merged on load. */
  remoteLoaded: boolean;
  persisted: boolean | null;
  /** Sample slugs the reader removed from the shelf. */
  hidden: string[];
}

const KEY = "gloss:v1";
const EMPTY: LibraryState = { docs: {}, progress: {}, annotations: {}, glosses: {}, remoteLoaded: false, persisted: null, hidden: [] };

let state: LibraryState = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load(): LibraryState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<LibraryState>), remoteLoaded: false };
  } catch {
    /* ignore */
  }
  return EMPTY;
}

function persistLocal() {
  try {
    const { docs, progress, annotations, glosses, persisted, hidden } = state;
    // Keep blocks only for documents that are not on the server.
    const slim: Record<string, GlossDocument> = {};
    for (const [k, d] of Object.entries(docs)) slim[k] = d.id?.startsWith("local:") || !d.id ? d : { ...d, blocks: [] };
    window.localStorage.setItem(KEY, JSON.stringify({ docs: slim, progress, annotations, glosses, persisted, hidden }));
  } catch (err) {
    console.warn("gloss: could not persist locally", err);
  }
}

function set(patch: Partial<LibraryState> | ((s: LibraryState) => Partial<LibraryState>)) {
  ensure();
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  persistLocal();
  listeners.forEach((l) => l());
}

function ensure() {
  if (!loaded && typeof window !== "undefined") {
    state = load();
    loaded = true;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getLibrary() {
  ensure();
  return state;
}

export function useLibrary() {
  return useSyncExternalStore(subscribe, getLibrary, () => EMPTY);
}

/* ------------------------------------------------------------------ API helpers */

async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Pull the server's document list and merge it in (runs once per page load). */
export async function syncRemoteLibrary() {
  ensure();
  const r = await api<{ documents: GlossDocument[]; persisted: boolean }>("/api/documents");
  if (!r) return;
  set((s) => {
    const docs = { ...s.docs };
    for (const d of r.documents) docs[d.slug] = { ...(docs[d.slug] ?? {}), ...d, blocks: docs[d.slug]?.blocks ?? [] };
    // Drop local-only shells for docs that exist on the server.
    return { docs, remoteLoaded: true, persisted: r.persisted };
  });
}

/* ------------------------------------------------------------------ documents */

export function rememberDocument(doc: GlossDocument, persisted: boolean) {
  const id = doc.id ?? `local:${doc.slug}`;
  set((s) => ({ docs: { ...s.docs, [doc.slug]: { ...doc, id, blocks: persisted ? [] : doc.blocks } }, persisted: s.persisted ?? persisted }));
}

export function getLocalDocument(slug: string): GlossDocument | null {
  ensure();
  const d = state.docs[slug];
  return d && d.blocks.length ? d : null;
}

export function updateDocumentMeta(slug: string, patch: Partial<Pick<GlossDocument, "topic" | "favourite" | "title">>) {
  ensure();
  const d = state.docs[slug];
  if (!d) return;
  set((s) => ({ docs: { ...s.docs, [slug]: { ...d, ...patch, updatedAt: new Date().toISOString() } } }));
  if (d.id && !d.id.startsWith("local:") && !d.id.startsWith("sample:")) void api(`/api/documents/${d.id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function removeDocument(slug: string) {
  ensure();
  const d = state.docs[slug];
  set((s) => {
    const docs = { ...s.docs };
    delete docs[slug];
    const id = d?.id ?? "";
    const annotations = { ...s.annotations };
    const glosses = { ...s.glosses };
    const progress = { ...s.progress };
    delete annotations[id];
    delete glosses[id];
    delete progress[id];
    return { docs, annotations, glosses, progress };
  });
  if (d?.id && !d.id.startsWith("local:") && !d.id.startsWith("sample:")) void api(`/api/documents/${d.id}`, { method: "DELETE" });
}

export function hideSample(slug: string) {
  set((s) => ({ hidden: s.hidden.includes(slug) ? s.hidden : [...s.hidden, slug] }));
}

/* ------------------------------------------------------------------ progress */

export function setProgress(documentId: string, p: Partial<ReadingProgress>) {
  ensure();
  const prev = state.progress[documentId];
  const next: ReadingProgress = { ...prev, ...p, documentId, ratio: p.ratio ?? prev?.ratio ?? 0, updatedAt: Date.now() };
  if (prev && Math.abs(prev.ratio - next.ratio) < 0.005 && prev.blockId === next.blockId && prev.finished === next.finished) return;
  set((s) => ({ progress: { ...s.progress, [documentId]: next } }));
  if (!documentId.startsWith("local:")) {
    window.clearTimeout(progressTimers[documentId]);
    progressTimers[documentId] = window.setTimeout(() => void api("/api/progress", { method: "PUT", body: JSON.stringify(next) }), 1200);
  }
}
const progressTimers: Record<string, number> = {};

/* ------------------------------------------------------------------ annotations */

function isRemote(documentId: string) {
  return !documentId.startsWith("local:");
}

export function addAnnotation(a: Annotation) {
  set((s) => ({ annotations: { ...s.annotations, [a.documentId]: [...(s.annotations[a.documentId] ?? []), a] } }));
  if (isRemote(a.documentId)) void api("/api/annotations", { method: "POST", body: JSON.stringify(a) });
}

export function updateAnnotation(documentId: string, id: string, patch: Partial<Annotation>) {
  set((s) => ({
    annotations: {
      ...s.annotations,
      [documentId]: (s.annotations[documentId] ?? []).map((a) => (a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a)),
    },
  }));
  if (isRemote(documentId)) void api(`/api/annotations/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function removeAnnotation(documentId: string, id: string) {
  set((s) => ({ annotations: { ...s.annotations, [documentId]: (s.annotations[documentId] ?? []).filter((a) => a.id !== id) } }));
  if (isRemote(documentId)) void api(`/api/annotations/${id}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ glosses */

export function upsertGloss(g: Gloss) {
  set((s) => {
    const list = s.glosses[g.documentId] ?? [];
    const i = list.findIndex((x) => x.id === g.id);
    const next = i >= 0 ? list.map((x) => (x.id === g.id ? g : x)) : [...list, g];
    return { glosses: { ...s.glosses, [g.documentId]: next } };
  });
}

/** Persist a finished gloss to the server (streaming ones are kept local until done). */
export function persistGloss(g: Gloss) {
  if (isRemote(g.documentId) && g.status === "done") void api("/api/glosses", { method: "POST", body: JSON.stringify(g) });
}

export function removeGloss(documentId: string, id: string) {
  set((s) => ({ glosses: { ...s.glosses, [documentId]: (s.glosses[documentId] ?? []).filter((g) => g.id !== id) } }));
  if (isRemote(documentId)) void api(`/api/glosses/${id}`, { method: "DELETE" });
}

/** Load server copies of annotations and glosses for a document and merge them in. */
export async function syncDocumentData(documentId: string) {
  if (!isRemote(documentId)) return;
  const r = await api<{ annotations: Annotation[]; glosses: Gloss[]; progress: ReadingProgress | null; persisted: boolean }>(
    `/api/documents/${encodeURIComponent(documentId)}/data`,
  );
  if (!r || !r.persisted) return;
  set((s) => {
    const mergeById = <T extends { id: string }>(local: T[], remote: T[]) => {
      const map = new Map<string, T>();
      remote.forEach((x) => map.set(x.id, x));
      local.forEach((x) => !map.has(x.id) && map.set(x.id, x));
      return [...map.values()];
    };
    return {
      annotations: { ...s.annotations, [documentId]: mergeById(s.annotations[documentId] ?? [], r.annotations) },
      glosses: { ...s.glosses, [documentId]: mergeById(s.glosses[documentId] ?? [], r.glosses.map((g) => ({ ...g, status: "done" as const }))) },
      progress: r.progress && (!s.progress[documentId] || r.progress.updatedAt > s.progress[documentId].updatedAt) ? { ...s.progress, [documentId]: r.progress } : s.progress,
      persisted: true,
    };
  });
  // Push local-only items the server does not have yet.
  const local = getLibrary();
  const remoteA = new Set(r.annotations.map((a) => a.id));
  for (const a of local.annotations[documentId] ?? []) if (!remoteA.has(a.id)) void api("/api/annotations", { method: "POST", body: JSON.stringify(a) });
  const remoteG = new Set(r.glosses.map((g) => g.id));
  for (const g of local.glosses[documentId] ?? []) if (!remoteG.has(g.id) && g.status === "done") void api("/api/glosses", { method: "POST", body: JSON.stringify(g) });
}

/* ------------------------------------------------------------------ user key */

export const USER_KEY = "gloss:key";
export function getUserKey() {
  try {
    return window.localStorage.getItem(USER_KEY) || "";
  } catch {
    return "";
  }
}
export function setUserKey(k: string) {
  try {
    if (k) window.localStorage.setItem(USER_KEY, k);
    else window.localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
