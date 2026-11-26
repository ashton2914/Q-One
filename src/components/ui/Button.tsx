import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "dashed";

export type ButtonSize = "xs" | "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-neutral-100 text-neutral-950 font-medium hover:bg-white disabled:bg-neutral-700 disabled:text-neutral-400",
  secondary:
    "bg-surface-raised text-ink-secondary font-medium hover:bg-surface-hover hover:text-white disabled:text-ink-disabled disabled:hover:bg-surface-raised",
  ghost:
    "bg-transparent text-ink-secondary hover:bg-surface-raised hover:text-white disabled:text-ink-disabled disabled:hover:bg-transparent",
  danger:
    "bg-transparent text-ink-muted hover:bg-rose-950/70 hover:text-rose-300 disabled:text-ink-disabled disabled:hover:bg-transparent",
  dashed:
    "border border-dashed border-border-control bg-surface-canvas/70 text-ink-primary font-medium hover:border-border-focus hover:bg-surface-raised hover:text-white disabled:text-ink-disabled",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "gap-1 rounded px-2 py-0.5 text-[11px]",
  sm: "gap-1.5 rounded px-2.5 py-1 text-xs",
  md: "gap-2 rounded-md px-4 py-2 text-xs",
};

export function Button({
  variant = "secondary",
  size = "sm",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center transition-colors disabled:cursor-not-allowed",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
}
