"use client";

import { useSyncExternalStore } from "react";
import type { Annotation, Gloss, GlossDocument, ReadingProgress } from "@/lib/content/types";
import { clampNote } from "@/lib/anchors";
import { toast } from "./toast";

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
  /** Ids deleted locally whose server delete has not been confirmed (tombstones). */
  deleted: { kind: "annotation" | "gloss" | "document"; id: string }[];
  /** Opaque key of the server-side reader the `syncedAt` marks refer to (a different reader invalidates them). */
  syncReader?: string;
}

const KEY = "gloss:v1";
const EMPTY: LibraryState = { docs: {}, progress: {}, annotations: {}, glosses: {}, remoteLoaded: false, persisted: null, hidden: [], deleted: [] };

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
    const { docs, progress, annotations, glosses, persisted, hidden, deleted, syncReader } = state;
    // Keep blocks only for documents that are not on the server.
    const slim: Record<string, GlossDocument> = {};
    for (const [k, d] of Object.entries(docs)) slim[k] = d.id?.startsWith("local:") || !d.id ? d : { ...d, blocks: [] };
    window.localStorage.setItem(KEY, JSON.stringify({ docs: slim, progress, annotations, glosses, persisted, hidden, deleted, syncReader }));
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

/** Forget everything kept in this browser (used on sign-out so the next reader starts clean). */
export function resetLocalLibrary() {
  state = EMPTY;
  loaded = true;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function getLibrary() {
  ensure();
  return state;
}

export function useLibrary() {
  return useSyncExternalStore(subscribe, getLibrary, () => EMPTY);
}

/* ------------------------------------------------------------------ API helpers */

let warned = 0;
/** One request. `null` = the network failed; otherwise the status and the parsed body (null for non-2xx). `quiet` statuses are expected and never toast. */
async function call<T>(path: string, init?: RequestInit, quiet: number[] = []): Promise<{ status: number; data: T | null } | null> {
  const mutating = !!init?.method && init.method !== "GET";
  try {
    const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    if (!res.ok) {
      if (mutating && res.status >= 400 && !quiet.includes(res.status) && Date.now() - warned > 8000) {
        warned = Date.now();
        toast(res.status === 400 ? "That could not be saved to your library (invalid data). It is kept in this browser." : "Could not sync to your library. Kept in this browser.", { ttl: 5000 });
      }
      return { status: res.status, data: null };
    }
    return { status: res.status, data: (await res.json()) as T };
  } catch {
    if (mutating && Date.now() - warned > 8000) {
      warned = Date.now();
      toast("You seem to be offline. Changes are kept in this browser and sync when you reload.", { ttl: 5000 });
    }
    return null;
  }
}
async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  return (await call<T>(path, init))?.data ?? null;
}

/**
 * Requests that touch the same item run strictly one after the other (a promise chain per id), so a DELETE
 * is never processed before the POST that creates the row, and PATCHes reach the server in the order they were made.
 */
const chains = new Map<string, Promise<unknown>>();
function enqueue<T>(id: string, job: () => Promise<T>): Promise<T> {
  const next = (chains.get(id) ?? Promise.resolve()).then(job, job);
  chains.set(id, next);
  void next.finally(() => {
    if (chains.get(id) === next) chains.delete(id);
  });
  return next;
}

/** Strip client-only fields before an item goes over the wire. */
function wire<T extends { syncedAt?: number }>(x: T) {
  const { syncedAt, ...rest } = x;
  void syncedAt;
  return rest;
}

const MAX_TOMBSTONES = 500;
function tombstone(kind: LibraryState["deleted"][number]["kind"], id: string) {
  set((s) => ({ deleted: s.deleted.some((d) => d.id === id) ? s.deleted : [...s.deleted, { kind, id }].slice(-MAX_TOMBSTONES) }));
}
function clearTombstone(id: string) {
  set((s) => ({ deleted: s.deleted.filter((d) => d.id !== id) }));
}
/** Delete on the server. The tombstone is cleared only when the server confirms (`persisted: true`), not for a cookie-less or database-less answer, nor for an error. */
function apiDelete(kind: LibraryState["deleted"][number]["kind"], path: string, id: string) {
  tombstone(kind, id);
  return enqueue(id, async () => {
    const r = await api<{ persisted?: boolean }>(path, { method: "DELETE" });
    if (r?.persisted === true) clearTombstone(id);
  });
}

/** Pull the server's document list and merge it in (runs once per page load). */
export async function syncRemoteLibrary() {
  ensure();
  const r = await api<{ documents: GlossDocument[]; persisted: boolean }>("/api/documents");
  if (!r) return;
  // Replay document deletes that never reached the server.
  for (const t of getLibrary().deleted.filter((d) => d.kind === "document")) void apiDelete("document", `/api/documents/${t.id}`, t.id);
  const pendingDocDeletes = new Set(getLibrary().deleted.filter((d) => d.kind === "document").map((d) => d.id));
  set((s) => {
    const docs = { ...s.docs };
    const remoteIds = new Set(r.documents.map((d) => d.id));
    for (const d of r.documents) if (!pendingDocDeletes.has(d.id ?? "")) docs[d.slug] = { ...(docs[d.slug] ?? {}), ...d, blocks: docs[d.slug]?.blocks ?? [] };
    if (r.persisted) {
      // Server-backed documents that are gone on the server were deleted elsewhere.
      for (const [slug, d] of Object.entries(docs)) {
        const id = d.id ?? "";
        if (id && !id.startsWith("local:") && !id.startsWith("sample:") && !remoteIds.has(id)) delete docs[slug];
      }
    }
    return { docs, remoteLoaded: true, persisted: r.persisted };
  });
}

/* ------------------------------------------------------------------ documents */

export function rememberDocument(doc: GlossDocument, persisted: boolean) {
  const id = doc.id ?? `local:${doc.slug}`;
  set((s) => ({ docs: { ...s.docs, [doc.slug]: { ...doc, id, blocks: persisted ? [] : doc.blocks } } }));
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

/** Resolves when the server has been told (or at once for a document that only lives in this browser), so a caller can navigate without the next page still listing it. */
export function removeDocument(slug: string): Promise<unknown> {
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
  if (d?.id && !d.id.startsWith("local:") && !d.id.startsWith("sample:")) return apiDelete("document", `/api/documents/${d.id}`, d.id);
  return Promise.resolve();
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

/**
 * Every confirmation from the server names the reader it came from. The first one is remembered; a different one later (the cookie
 * now names another reader, e.g. after a sign-in) invalidates every `syncedAt` mark, so items are re-uploaded instead of dropped.
 */
function readerPatch(s: LibraryState, key?: string): Partial<LibraryState> {
  if (!key || s.syncReader === key) return {};
  if (!s.syncReader) return { syncReader: key };
  const forget = <T extends { syncedAt?: number }>(all: Record<string, T[]>) => Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.map((x) => ({ ...x, syncedAt: undefined }))]));
  return { syncReader: key, annotations: forget(s.annotations), glosses: forget(s.glosses) };
}

/** Record that the server holds the version of annotation `id` whose `updatedAt` is `version`. */
function markSynced(documentId: string, id: string, version: number, readerKey?: string) {
  set((s) => {
    const rp = readerPatch(s, readerKey);
    const annotations = rp.annotations ?? s.annotations;
    return { ...rp, annotations: { ...annotations, [documentId]: (annotations[documentId] ?? []).map((a) => (a.id === id ? { ...a, syncedAt: Math.max(a.syncedAt ?? 0, version) } : a)) } };
  });
}

function pushAnnotation(a: Annotation) {
  return enqueue(a.id, async () => {
    const r = await api<{ persisted?: boolean; readerKey?: string }>("/api/annotations", { method: "POST", body: JSON.stringify(wire(a)) });
    if (r?.persisted === true) markSynced(a.documentId, a.id, a.updatedAt, r.readerKey);
  });
}

export function addAnnotation(a: Annotation) {
  set((s) => ({ annotations: { ...s.annotations, [a.documentId]: [...(s.annotations[a.documentId] ?? []), a] } }));
  if (isRemote(a.documentId)) void pushAnnotation(a);
}

export function updateAnnotation(documentId: string, id: string, patchIn: Partial<Annotation>) {
  ensure();
  const patch = patchIn.note !== undefined ? { ...patchIn, note: clampNote(patchIn.note) } : patchIn;
  const prev = (state.annotations[documentId] ?? []).find((a) => a.id === id);
  if (!prev) return;
  // Strictly newer than the version being replaced, even if the clock went backwards.
  const updatedAt = Math.max(Date.now(), prev.updatedAt + 1);
  set((s) => ({ annotations: { ...s.annotations, [documentId]: (s.annotations[documentId] ?? []).map((a) => (a.id === id ? { ...a, ...patch, updatedAt } : a)) } }));
  if (!isRemote(documentId)) return;
  const body = { ...(patch.color ? { color: patch.color } : {}), ...(patch.note !== undefined ? { note: patch.note } : {}), ...(patch.kind ? { kind: patch.kind } : {}), updatedAt };
  void enqueue(id, async () => {
    const r = await call<{ persisted?: boolean; readerKey?: string }>(`/api/annotations/${id}`, { method: "PATCH", body: JSON.stringify(body) }, [404]);
    if (r?.status === 404) {
      // The row does not exist yet (its create never reached the server): send the whole current version instead.
      const cur = (getLibrary().annotations[documentId] ?? []).find((a) => a.id === id);
      if (cur) {
        const full = await api<{ persisted?: boolean; readerKey?: string }>("/api/annotations", { method: "POST", body: JSON.stringify(wire(cur)) });
        if (full?.persisted === true) markSynced(documentId, id, cur.updatedAt, full.readerKey);
      }
    } else if (r?.data?.persisted === true) markSynced(documentId, id, updatedAt, r.data.readerKey);
  });
}

export function removeAnnotation(documentId: string, id: string) {
  set((s) => ({ annotations: { ...s.annotations, [documentId]: (s.annotations[documentId] ?? []).filter((a) => a.id !== id) } }));
  if (isRemote(documentId)) void apiDelete("annotation", `/api/annotations/${id}`, id);
}

/* ------------------------------------------------------------------ glosses */

export function upsertGloss(g: Gloss) {
  set((s) => {
    const list = s.glosses[g.documentId] ?? [];
    const i = list.findIndex((x) => x.id === g.id);
    // New content (a follow-up, streamed text) is no longer what the server has confirmed.
    const kept: Gloss = i >= 0 && list[i].turns === g.turns && list[i].result === g.result ? g : { ...g, syncedAt: undefined };
    const next = i >= 0 ? list.map((x) => (x.id === g.id ? kept : x)) : [...list, kept];
    return { glosses: { ...s.glosses, [g.documentId]: next } };
  });
}

/** Persist a finished gloss to the server (streaming ones are kept local until done). */
export function persistGloss(g: Gloss) {
  if (!isRemote(g.documentId) || g.status !== "done") return;
  void enqueue(g.id, async () => {
    const r = await api<{ persisted?: boolean; readerKey?: string }>("/api/glosses", { method: "POST", body: JSON.stringify(wire(g)) });
    if (r?.persisted !== true) return;
    // Only mark the version that was sent (a follow-up may have replaced `turns` in the meantime).
    set((s) => {
      const rp = readerPatch(s, r.readerKey);
      const glosses = rp.glosses ?? s.glosses;
      return { ...rp, glosses: { ...glosses, [g.documentId]: (glosses[g.documentId] ?? []).map((x) => (x.id === g.id && x.turns === g.turns && x.result === g.result ? { ...x, syncedAt: Date.now() } : x)) } };
    });
  });
}

export function removeGloss(documentId: string, id: string) {
  set((s) => ({ glosses: { ...s.glosses, [documentId]: (s.glosses[documentId] ?? []).filter((g) => g.id !== id) } }));
  if (isRemote(documentId)) void apiDelete("gloss", `/api/glosses/${id}`, id);
}

/** Load server copies of annotations and glosses for a document and merge them in. */
export async function syncDocumentData(documentId: string) {
  if (!isRemote(documentId)) return;
  const r = await api<{ annotations: Annotation[]; glosses: Gloss[]; progress: ReadingProgress | null; persisted: boolean; readerKey?: string }>(
    `/api/documents/${encodeURIComponent(documentId)}/data`,
  );
  if (!r) return;
  if (!r.persisted) {
    set({ persisted: false });
    return;
  }
  // `syncedAt` marks only mean something for the reader that confirmed them. After a sign-in the cookie names another
  // reader: forget the marks so local items are re-uploaded to it instead of being taken for "deleted elsewhere".
  const readerChanged = !!r.readerKey && getLibrary().syncReader !== r.readerKey;
  // Replay deletes the server has not confirmed yet.
  for (const t of getLibrary().deleted) {
    if (t.kind === "annotation") void apiDelete("annotation", `/api/annotations/${t.id}`, t.id);
    if (t.kind === "gloss") void apiDelete("gloss", `/api/glosses/${t.id}`, t.id);
  }
  const dead = new Set(getLibrary().deleted.map((d) => d.id));
  set((s) => {
    const forget = <T extends { syncedAt?: number }>(x: T): T => (readerChanged ? { ...x, syncedAt: undefined } : x);
    // A local item the server confirmed, not edited since, and now missing, was deleted on another device: drop it.
    const deletedElsewhere = (x: { syncedAt?: number; updatedAt?: number }) => x.syncedAt !== undefined && (x.updatedAt ?? 0) <= x.syncedAt;
    const mergeAnnotations = (local: Annotation[], remote: Annotation[]) => {
      const rm = new Map(remote.filter((x) => !dead.has(x.id)).map((x) => [x.id, x]));
      const out = new Map<string, Annotation>();
      for (const [id, x] of rm) out.set(id, { ...x, syncedAt: x.updatedAt });
      for (const l of local) {
        const x = forget(l);
        if (dead.has(x.id)) continue;
        const cur = rm.get(x.id);
        if (!cur) {
          if (!deletedElsewhere(x)) out.set(x.id, x);
        } else if (x.updatedAt > cur.updatedAt) out.set(x.id, x); // a newer local edit survives (it is pushed below)
      }
      return [...out.values()];
    };
    const mergeGlosses = (local: Gloss[], remote: Gloss[]) => {
      const rm = new Map(remote.filter((x) => !dead.has(x.id)).map((x) => [x.id, { ...x, status: "done" as const, syncedAt: Date.now() }]));
      const out = new Map<string, Gloss>(rm);
      for (const l of local) {
        const x = forget(l);
        if (dead.has(x.id) || rm.has(x.id)) continue;
        if (x.status === "done" && x.syncedAt !== undefined) continue; // deleted on another device
        out.set(x.id, x);
      }
      return [...out.values()];
    };
    const reset = <T extends { syncedAt?: number }>(all: Record<string, T[]>) => (readerChanged ? Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.map(forget)])) : all);
    return {
      annotations: { ...reset(s.annotations), [documentId]: mergeAnnotations(s.annotations[documentId] ?? [], r.annotations) },
      glosses: { ...reset(s.glosses), [documentId]: mergeGlosses(s.glosses[documentId] ?? [], r.glosses) },
      progress: r.progress && (!s.progress[documentId] || r.progress.updatedAt > s.progress[documentId].updatedAt) ? { ...s.progress, [documentId]: r.progress } : s.progress,
      persisted: true,
      ...(r.readerKey ? { syncReader: r.readerKey } : {}),
    };
  });
  // Push local items the server does not have yet, or has an older version of.
  const local = getLibrary();
  const remoteA = new Map(r.annotations.map((a) => [a.id, a.updatedAt]));
  for (const a of local.annotations[documentId] ?? []) {
    const ru = remoteA.get(a.id);
    if (ru === undefined || a.updatedAt > ru) void pushAnnotation(a);
  }
  const remoteG = new Set(r.glosses.map((g) => g.id));
  for (const g of local.glosses[documentId] ?? []) if (!remoteG.has(g.id) && g.status === "done") persistGloss(g);
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
