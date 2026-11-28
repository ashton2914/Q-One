import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

export interface FloatingMenuProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "style"> {
  /** Anchor viewport X coordinate (e.g. MouseEvent.clientX) */
  x: number;
  /** Anchor viewport Y coordinate (e.g. MouseEvent.clientY) */
  y: number;
  /** Minimum margin from viewport edges in pixels */
  margin?: number;
}

/**
 * Portal-rendered floating menu / popover that escapes ancestor overflow & stacking contexts
 * and automatically flips/clamps itself inside the window viewport so it is never clipped.
 */
export function FloatingMenu({
  x,
  y,
  margin = 8,
  className,
  children,
  ...rest
}: FloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>(
    {
      left: x,
      top: y,
      ready: false,
    },
  );

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x;
    let top = y;

    // Flip horizontally if overflowing right edge and there is more room on the left
    if (left + rect.width > vw - margin) {
      const flippedLeft = x - rect.width;
      left =
        flippedLeft >= margin
          ? flippedLeft
          : Math.max(margin, vw - rect.width - margin);
    }
    if (left < margin) left = margin;

    // Flip vertically if overflowing bottom edge and there is room above; otherwise clamp
    if (top + rect.height > vh - margin) {
      const flippedTop = y - rect.height;
      top =
        flippedTop >= margin
          ? flippedTop
          : Math.max(margin, vh - rect.height - margin);
    }
    if (top < margin) top = margin;

    setPos({ left, top, ready: true });
  }, [x, y, margin, children]);

  return createPortal(
    <div
      ref={menuRef}
      data-floating-menu="true"
      style={{
        left: pos.left,
        top: pos.top,
        maxHeight: `calc(100vh - ${margin * 2}px)`,
        visibility: pos.ready ? "visible" : "hidden",
      }}
      onWheel={(e) => e.stopPropagation()}
      className={cn(
        "fixed z-[100] overflow-y-auto overscroll-contain",
        className,
      )}
      {...rest}
    >
      {children}
    </div>,
    document.body,
  );
}
