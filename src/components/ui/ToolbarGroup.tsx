import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export type ToolbarGroupProps = HTMLAttributes<HTMLDivElement>;

export function ToolbarGroup({ className, ...props }: ToolbarGroupProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded bg-surface-canvas px-1 py-0.5 ring-1 ring-border-subtle",
        className,
      )}
      {...props}
    />
  );
}
