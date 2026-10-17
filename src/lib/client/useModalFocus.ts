"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href], summary, button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open modal dialogs, innermost last: only the top one traps Tab, so a dialog opened from another keeps working. */
const stack: HTMLElement[] = [];

/**
 * Focus handling for an `aria-modal` dialog: focus moves inside when it opens (to `[data-autofocus]` when present, else the
 * first control), Tab and Shift+Tab wrap inside it, and focus goes back to whatever opened it when it closes.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const opener = document.activeElement instanceof HTMLElement && !root.contains(document.activeElement) ? document.activeElement : null;
    const reachable = (el: HTMLElement) => {
      // Content of a closed <details> has a box in some engines but cannot take focus; only its <summary> can.
      const closed = el.closest("details:not([open])");
      if (closed && el.parentElement !== closed) return false;
      return typeof el.checkVisibility === "function" ? el.checkVisibility() : el.getClientRects().length > 0;
    };
    const controls = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(reachable);
    stack.push(root);
    if (!root.contains(document.activeElement)) {
      if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
      (root.querySelector<HTMLElement>("[data-autofocus]") ?? controls()[0] ?? root).focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || stack[stack.length - 1] !== root) return;
      const list = controls();
      const here = document.activeElement;
      if (!list.length) {
        e.preventDefault();
        root.focus({ preventScroll: true });
      } else if (!root.contains(here)) {
        e.preventDefault();
        list[e.shiftKey ? list.length - 1 : 0].focus();
      } else if (e.shiftKey && (here === list[0] || here === root)) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && here === list[list.length - 1]) {
        e.preventDefault();
        list[0].focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = stack.lastIndexOf(root);
      if (i >= 0) stack.splice(i, 1);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
