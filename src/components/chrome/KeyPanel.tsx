"use client";

import { useEffect, useState } from "react";
import { getUserKey, setUserKey } from "@/lib/store/library";
import { useT } from "@/i18n/client";

export function KeyPanel({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const [value, setValue] = useState(() => getUserKey());
  const [saved, setSaved] = useState(() => !!getUserKey());
  const [status, setStatus] = useState<{ serverKey: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/gloss", { method: "GET" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setStatus({ serverKey: !!j.serverKey }))
      .catch(() => setStatus({ serverKey: false }));
  }, []);

  return (
    <div>
      <p className="text-[13.5px] font-medium text-ink">{t("key.title")}</p>
      <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
        {status?.serverKey
          ? t("key.serverKey")
          : t("key.needKey")}
      </p>
      <input
        type="password"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        placeholder="tgp_v1_..."
        autoComplete="off"
        spellCheck={false}
        aria-label={t("key.label")}
        className="mt-3 h-9 w-full rounded-lg border border-rule bg-bg px-3 text-[13px] tracking-wide text-ink outline-none placeholder:text-ink-4 focus:border-rule-strong focus-visible:outline-none"
      />
      <p className="mt-2 text-[11.5px] leading-snug text-ink-4">{t("key.privacy")}</p>
      <div className="mt-3 flex items-center justify-between">
        <a href="https://api.together.ai/settings/api-keys" target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-rubric-text underline decoration-rule-strong underline-offset-4">
          {t("key.get")}
        </a>
        <div className="flex gap-1.5">
          {value && saved ? (
            <button
              type="button"
              className="h-8 rounded-lg px-3 text-[12.5px] font-medium text-ink-3 hover:bg-sunk hover:text-ink"
              onClick={() => {
                setUserKey("");
                setValue("");
                setSaved(false);
              }}
            >
              {t("common.remove")}
            </button>
          ) : null}
          <button
            type="button"
            disabled={!value.trim() || saved}
            className="h-8 rounded-lg bg-ink px-3.5 text-[12.5px] font-medium text-bg disabled:opacity-60"
            onClick={() => {
              setUserKey(value.trim());
              setSaved(true);
              onDone?.();
            }}
          >
            {saved ? t("common.saved") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
