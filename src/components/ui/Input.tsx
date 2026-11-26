import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "./cn";

export type InputSurface = "on-chrome" | "on-canvas" | "inline";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  surface?: InputSurface;
  mono?: boolean;
  ref?: Ref<HTMLInputElement>;
}

const SURFACE_CLASSES: Record<InputSurface, string> = {
  "on-chrome":
    "w-full rounded border border-border-control bg-surface-canvas px-2 py-1 text-xs text-ink-primary placeholder:text-ink-disabled focus:border-border-focus focus:outline-none",
  "on-canvas":
    "w-full rounded border border-border-control bg-surface-chrome px-2 py-1 text-xs text-ink-primary placeholder:text-ink-disabled focus:border-border-focus focus:outline-none",
  inline:
    "rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-ink-primary placeholder:text-ink-disabled hover:border-border-subtle focus:border-border-focus focus:bg-surface-canvas focus:outline-none",
};

export function Input({
  surface = "on-chrome",
  mono = false,
  className,
  ref,
  ...props
}: InputProps) {
  return (
    <input
      ref={ref}
      className={cn(SURFACE_CLASSES[surface], mono && "font-mono", className)}
      {...props}
    />
  );
}
