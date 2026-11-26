import type { SVGProps } from "react";

export function QOneLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M41.13 48.77 A20 20 0 1 1 51.13 22.05"
        stroke="currentColor"
        strokeWidth="8.5"
        strokeLinecap="butt"
      />
      <path
        d="M55 27.5H49.2L40.2 34.3V40.3L46.5 35.5V57H55V27.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
