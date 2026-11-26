import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export type BadgeTone =
  | "neutral"
  | "active"
  | "accent"
  | "warning"
  | "danger"
  | "point";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-surface-raised text-ink-muted ring-border-control",
  active: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
  accent: "bg-blue-500/15 text-blue-300 ring-blue-500/40",
  warning: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  danger: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
  point: "bg-purple-500/15 text-purple-300 ring-purple-500/40",
};

const DOT_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-ink-muted",
  active: "bg-accent-active",
  accent: "bg-accent-selection",
  warning: "bg-accent-warning",
  danger: "bg-accent-danger",
  point: "bg-accent-point",
};

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASSES[tone])}
        />
      )}
      {children}
    </span>
  );
}
