// Stroke icons (24 × 24), drawn with currentColor.
const PATHS = {
  logo: "M3 3 H21 V21 H3 Z M9 3 V21 M15 3 V21 M3 9 H21 M3 15 H21",
  open: "M3 7 V19 H21 V9 H11 L9 7 Z",
  save: "M12 3 V14 M7 9 L12 14 L17 9 M4 17 V20 H20 V17",
  undo: "M9 6 L4 11 L9 16 M4 11 H15 A5 5 0 0 1 15 21 H11",
  redo: "M15 6 L20 11 L15 16 M20 11 H9 A5 5 0 0 0 9 21 H13",
  play: "M7 4 L19 12 L7 20 Z",
  cube: "M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z M4 7.5 L12 12 L20 7.5 M12 12 V21",
  chart: "M4 20 V4 M4 20 H20 M7 16 L11 11 L14 13 L19 7",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      class="icon"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
