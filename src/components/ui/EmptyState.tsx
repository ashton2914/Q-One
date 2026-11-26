import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  size?: "sm" | "lg";
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  actions,
  size = "sm",
  className,
}: EmptyStateProps) {
  const isLarge = size === "lg";
  return (
    <div
      className={cn(
        "rounded-xl border border-border-subtle bg-surface-chrome/90 text-center shadow-xl",
        isLarge ? "max-w-lg p-8" : "max-w-sm p-6",
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            "mx-auto flex items-center justify-center bg-surface-raised text-ink-secondary ring-1 ring-border-control",
            isLarge ? "mb-4 h-12 w-12 rounded-xl" : "mb-3 h-10 w-10 rounded-lg",
          )}
        >
          {icon}
        </div>
      )}
      <h2
        className={cn(
          "font-semibold text-ink-primary",
          isLarge ? "text-lg" : "text-sm",
        )}
      >
        {title}
      </h2>
      <p
        className={cn(
          "text-xs leading-relaxed text-ink-muted",
          isLarge ? "mt-2" : "mt-1.5",
        )}
      >
        {description}
      </p>
      {actions && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-center",
            isLarge ? "mt-6 gap-2.5" : "mt-4 gap-2",
          )}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
