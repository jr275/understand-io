"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean };

/** 36px round topbar button. */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { className = "", active = false, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2.5 max-[360px]:min-w-8 max-[360px]:px-2 text-[13.5px] font-medium leading-none text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-sunk hover:text-ink active:scale-[0.94] ${
        active ? "bg-sunk text-ink" : ""
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
