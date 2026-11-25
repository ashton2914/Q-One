import { FileText, Network } from "lucide-react";
import type { ActiveModule } from "../types/project";

export interface ActivityBarProps {
  activeModule: ActiveModule;
  onSelectModule: (module: ActiveModule) => void;
  hasActiveDrawing: boolean;
}

export function ActivityBar({
  activeModule,
  onSelectModule,
  hasActiveDrawing,
}: ActivityBarProps) {
  const items: Array<{
    id: ActiveModule;
    label: string;
    icon: typeof Network;
    indicator?: boolean;
  }> = [
    { id: "project", label: "Project", icon: Network },
    {
      id: "drawing",
      label: "Drawing",
      icon: FileText,
      indicator: hasActiveDrawing,
    },
  ];

  return (
    <nav
      aria-label="Modules"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-neutral-800 bg-neutral-950 py-2 select-none"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeModule === item.id;
        return (
          <button
            key={item.id}
            type="button"
            title={item.label}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onSelectModule(item.id)}
            className={`group relative flex h-10 w-10 flex-col items-center justify-center rounded-md transition-colors ${
              isActive
                ? "bg-neutral-800 text-white"
                : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
            }`}
          >
            {isActive && (
              <span className="absolute -left-1 top-2 bottom-2 w-0.5 rounded-r bg-blue-500" />
            )}
            <Icon className="h-4 w-4" />
            <span className="mt-0.5 text-[9px] font-medium leading-none">
              {item.label}
            </span>
            {item.indicator && !isActive && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
