"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/store/toast";

/** Shows a one-off message passed in the URL (e.g. `/?signin=…` after a failed sign-in) and cleans the URL. */
export function Notice({ text }: { text: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!text) return;
    toast(text, { ttl: 8000 });
    router.replace("/", { scroll: false });
  }, [text, router]);
  return null;
}
