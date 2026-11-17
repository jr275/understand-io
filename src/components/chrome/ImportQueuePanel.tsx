"use client";

import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  CircleSlash,
  Clock,
  Copy,
  Loader2,
  X,
} from "lucide-react";
import { importQueue, useImportQueue } from "@/lib/client/importQueue";
import type { QueueItem } from "@/lib/store/importQueue";
import { useI18n, useT } from "@/i18n/client";
import { localizeServerMessage as lm } from "@/i18n/serverMessages";

const size = (n: number, num: (x: number, o?: Intl.NumberFormatOptions) => string) =>
  n >= 1024 * 1024
    ? `${num(n / 1024 / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

function Status({ item }: { item: QueueItem }) {
  const t = useT();
  switch (item.state) {
    case "waiting":
      return (
        <span className="inline-flex items-center gap-1.5 text-lens-mute">
          <Clock size={13} aria-hidden="true" /> {t("importQueue.waiting")}
        </span>
      );
    case "sending":
      return (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 size={13} className="animate-spin" aria-hidden="true" />{" "}
          {t("importQueue.sending")}
        </span>
      );
    case "done":
      return (
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 size={13} aria-hidden="true" /> {t("importQueue.ready")}
        </span>
      );
    case "duplicate":
      return (
        <span className="inline-flex items-center gap-1.5">
          <Copy size={13} aria-hidden="true" /> {t("importQueue.duplicate")}
        </span>
      );
    case "cancelled":
      return (
        <span className="inline-flex items-center gap-1.5 text-lens-mute">
          <CircleSlash size={13} aria-hidden="true" /> {t("importQueue.cancelled")}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-start gap-1.5">
          <AlertCircle
            size={13}
            className="mt-[3px] shrink-0"
            aria-hidden="true"
          />{" "}
          <span>{t("importQueue.failed", { error: lm(item.error) })}</span>
        </span>
      );
  }
}

/** The line of files being imported together: one row each, with what actually happened to it and what can be done next. */
export function ImportQueuePanel() {
  const { t, fmt } = useI18n();
  const items = useImportQueue();
  if (!items.length) return null;
  const active = items.some(
    (i) => i.state === "waiting" || i.state === "sending",
  );
  const finished = items.filter(
    (i) => i.state !== "waiting" && i.state !== "sending",
  ).length;
  return (
    <section
      aria-label={t("importQueue.region")}
      className="fixed left-3 z-[56] w-[min(400px,calc(100vw-24px))] rounded-[18px] bg-lens p-3 text-[13px] leading-snug text-lens-fg shadow-pop"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
    >
      <div className="flex items-center justify-between gap-2 pb-2">
        <p className="font-medium">
          {active
            ? t("importQueue.importing", { total: items.length, done: finished })
            : t("importQueue.finished", { total: items.length })}
        </p>
        {active ? (
          <button
            type="button"
            className="underline decoration-lens-mute underline-offset-4"
            onClick={() => importQueue.cancelAll()}
          >
            {t("importQueue.cancelRemaining")}
          </button>
        ) : (
          <span className="flex items-center gap-2">
            <Link
              className="underline decoration-lens-mute underline-offset-4"
              href="/library"
            >
              {t("importQueue.openLibrary")}
            </Link>
            <button
              type="button"
              aria-label={t("importQueue.dismissList")}
              className="grid size-7 place-items-center rounded-full text-lens-mute hover:bg-lens-hover hover:text-lens-fg"
              onClick={() => importQueue.clearFinished()}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </span>
        )}
      </div>
      <ul className="max-h-[40vh] space-y-2 overflow-auto" aria-label={t("importQueue.files")}>
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-[12px] bg-lens-hover/40 px-2.5 py-2"
            data-state={item.state}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-medium" title={item.name}>
                {item.name}
              </span>
              <span className="shrink-0 text-lens-mute">{size(item.size, fmt.number)}</span>
            </div>
            <div className="mt-1 flex items-start justify-between gap-2">
              <Status item={item} />
              <span className="flex shrink-0 gap-3">
                {(item.state === "done" || item.state === "duplicate") &&
                item.slug ? (
                  <Link
                    className="underline decoration-lens-mute underline-offset-4"
                    href={`/read/${item.slug}`}
                  >
                    {t("common.open")}
                  </Link>
                ) : null}
                {item.state === "failed" || item.state === "cancelled" ? (
                  item.state === "cancelled" ||
                  !/^Only /.test(item.error ?? "") ? (
                    <button
                      type="button"
                      className="underline decoration-lens-mute underline-offset-4"
                      onClick={() => importQueue.retry(item.id)}
                    >
                      {t("importQueue.tryAgain")}
                    </button>
                  ) : null
                ) : null}
                {item.state === "waiting" || item.state === "sending" ? (
                  <button
                    type="button"
                    className="underline decoration-lens-mute underline-offset-4"
                    aria-label={t("importQueue.cancelItem", { name: item.name })}
                    onClick={() => importQueue.cancel(item.id)}
                  >
                    {t("common.cancel")}
                  </button>
                ) : null}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p role="status" className="sr-only">
        {active
          ? t("importQueue.progress", { done: finished, total: items.length })
          : t("importQueue.summary", { done: items.filter((i) => i.state === "done").length, total: items.length })}
      </p>
    </section>
  );
}
