import type { ReactNode, SVGProps } from "react";

// One family of thin line icons (24px grid, 1.5 stroke, round caps) so the interface speaks one visual language.
const PATHS: Record<string, ReactNode> = {
  check: <path d="M5 12.5l4.2 4.2L19 7.3" />,
  document: <><path d="M7 3.5h7l4 4V20a.5.5 0 01-.5.5h-10.5a.5.5 0 01-.5-.5V4a.5.5 0 01.5-.5z" /><path d="M14 3.5V8h4M9.5 12.5h5M9.5 16h5" /></>,
  bank: <><path d="M3.5 9.5L12 4l8.5 5.5" /><path d="M5.5 10v7M10 10v7M14 10v7M18.5 10v7M3.5 20h17M4.5 17h15" /></>,
  card: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18M6.5 15h3.5" /></>,
  swap: <><path d="M4 8.5h14.5M15 5l3.5 3.5L15 12" /><path d="M20 15.5H5.5M9 12l-3.5 3.5L9 19" /></>,
  wallet: <><path d="M4 7.5A2.5 2.5 0 016.5 5H18v3" /><rect x="3.5" y="7.5" width="17" height="12" rx="2.5" /><path d="M16 13.5h2.5" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="14.5" rx="2.5" /><path d="M8 3.5v4M16 3.5v4M4 10.5h16" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8 10.5V8a4 4 0 018 0v2.5" /></>,
  shield: <><path d="M12 3.5l7 2.6v5.4c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6.1l7-2.6z" /><path d="M9 12l2.2 2.2L15.2 10" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.01" /></>,
  alert: <><path d="M12 4.5l8.5 14.5h-17L12 4.5z" /><path d="M12 10v4.2M12 16.8v.01" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  sliders: <><path d="M4 8h9M17 8h3M4 16h3M11 16h9" /><circle cx="15" cy="8" r="2" /><circle cx="9" cy="16" r="2" /></>,
  spark: <><path d="M12 4l1.7 5.1L19 11l-5.3 1.9L12 18l-1.7-5.1L5 11l5.3-1.9L12 4z" /></>,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  upload: <><path d="M12 15.5V5M7.5 9.5L12 5l4.5 4.5" /><path d="M5 15v3a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0019 18v-3" /></>,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5c.9-3.4 3.6-5 7-5s6.1 1.6 7 5" /></>,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.5 3.6 5.3 3.6 8.5s-1.2 6-3.6 8.5c-2.4-2.5-3.6-5.3-3.6-8.5S9.6 6 12 3.5z" /></>,
  coins: <><ellipse cx="12" cy="7" rx="6.5" ry="2.8" /><path d="M5.5 7v5c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8V7M5.5 12v5c0 1.5 2.9 2.8 6.5 2.8s6.5-1.3 6.5-2.8v-5" /></>,
  retry: <><path d="M19.5 12a7.5 7.5 0 11-2.4-5.5" /><path d="M19.5 4.5v4h-4" /></>,
  edit: <><path d="M5 19l1-4L16.5 4.5a1.8 1.8 0 012.5 0l.5.5a1.8 1.8 0 010 2.5L9 18l-4 1z" /></>,
  file: <><path d="M6.5 3.5h7l4 4V20.5h-11z" /><path d="M13.5 3.5V8h4" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {PATHS[name]}
    </svg>
  );
}

/** The TB monogram: a T whose bar leads into a B. Drawn with strokes so it follows the text color. */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size * 1.22} height={size} viewBox="0 0 44 36" fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="TuitionBridge">
      <path d="M3 6h19M12.5 6v24" />
      <path d="M27 6v24M27 6h6.5a6 6 0 010 12H27M27 18h7.5a6 6 0 010 12H27" />
    </svg>
  );
}
