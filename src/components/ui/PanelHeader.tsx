import type { ReactNode } from "react";
import { cn } from "./cn";

export interface PanelHeaderProps {
  title: string;
  count?: number;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PanelHeader({
  title,
  count,
  subtitle,
  actions,
  className,
}: PanelHeaderProps) {
  return (
    <div
      className={cn("border-b border-border-subtle px-3 py-2.5", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            {title}
          </h2>
          {count !== undefined && (
            <span className="rounded-full bg-surface-raised px-2 py-0.5 font-mono text-[11px] text-ink-muted">
              {count}
            </span>
          )}
        </div>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      {subtitle && <div className="mt-1">{subtitle}</div>}
    </div>
  );
}
