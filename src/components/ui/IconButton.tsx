import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export type IconButtonVariant = "ghost" | "subtle" | "danger";
export type IconButtonSize = "xs" | "sm";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  "aria-label": string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  ghost:
    "text-ink-muted hover:bg-surface-raised hover:text-white disabled:text-ink-disabled disabled:hover:bg-transparent",
  subtle:
    "bg-surface-raised text-ink-secondary hover:bg-surface-hover hover:text-white disabled:text-ink-disabled disabled:hover:bg-surface-raised",
  danger:
    "text-ink-subtle hover:bg-rose-950 hover:text-rose-400 disabled:text-ink-disabled disabled:hover:bg-transparent",
};

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  xs: "p-0.5",
  sm: "p-1",
};

export function IconButton({
  variant = "ghost",
  size = "sm",
  type = "button",
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded transition-colors disabled:cursor-not-allowed",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
}
