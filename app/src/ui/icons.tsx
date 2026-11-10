// Stroke icons (24 × 24), drawn with currentColor.
const PATHS = {
  logo: "M3 3 H21 V21 H3 Z M9 3 V21 M15 3 V21 M3 9 H21 M3 15 H21",
  open: "M3 7 V19 H21 V9 H11 L9 7 Z",
  save: "M12 3 V14 M7 9 L12 14 L17 9 M4 17 V20 H20 V17",
  undo: "M9 6 L4 11 L9 16 M4 11 H15 A5 5 0 0 1 15 21 H11",
  redo: "M15 6 L20 11 L15 16 M20 11 H9 A5 5 0 0 0 9 21 H13",
  play: "M7 4 L19 12 L7 20 Z",
  stop: "M6 6 H18 V18 H6 Z",
  cube: "M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z M4 7.5 L12 12 L20 7.5 M12 12 V21",
  chart: "M4 20 V4 M4 20 H20 M7 16 L11 11 L14 13 L19 7",
  mesh: "M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z M4 7.5 L12 12 L20 7.5 M12 12 V21",
  cellset: "M4 4 H20 V20 H4 Z M4 9.3 H20 M4 14.6 H20 M9.3 4 V20 M14.6 4 V20",
  merge: "M6 4 V10 L12 14 L18 10 V4 M12 14 V20",
  pointset:
    "M5 6 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0 M10.7 6 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0 M16.4 6 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0 M5 12 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0 M5 18 a1.3 1.3 0 1 0 2.6 0 a1.3 1.3 0 1 0 -2.6 0",
  material: "M12 3 A9 9 0 1 0 12 21 A9 9 0 1 0 12 3 M3 12 C 8 15, 16 15, 21 12",
  section:
    "M6 4 H18 Q20 4 20 6 V18 Q20 20 18 20 H6 Q4 20 4 18 V6 Q4 4 6 4 Z M8 12 H16",
  boundary: "M12 4 L19 16 H5 Z M4 20 H20",
  step: "M4 20 H9 V15 H14 V10 H19 V5",
  job: "M7 4 L19 12 L7 20 Z",
  warning: "M12 4 L21 20 H3 Z M12 10 V14 M12 17 V17.5",
  eye: "M2 12 C 5 6, 19 6, 22 12 C 19 18, 5 18, 2 12 Z M9 12 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0",
  eyeOff: "M2 12 C 5 6, 19 6, 22 12 C 19 18, 5 18, 2 12 Z M4 4 L20 20",
  chevronRight: "M9 6 L15 12 L9 18",
  chevronDown: "M6 9 L12 15 L18 9",
  trash: "M4 7 H20 M9 7 V4 H15 V7 M6 7 L7 20 H17 L18 7",
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
