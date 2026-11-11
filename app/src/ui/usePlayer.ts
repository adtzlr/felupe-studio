// Play the substeps of a job (#141): the next substep is shown once the current one
// is shown and its time is over, so a slow scene delays the play instead of skipping
// substeps; after the last substep the first one follows. The scenes ahead are loaded
// while playing (`ahead`).
import { useEffect, useRef, useState } from "preact/hooks";
import { nextSubstep, substepsAhead } from "../core/results";

/** The speeds of playing, in substeps per second. */
export const SPEEDS = [1, 2, 5, 10, 20] as const;
export type Speed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: Speed = 5;

/** The number of scenes loaded ahead while playing. */
const AHEAD = 4;

interface Options {
  /** Playing is possible, e.g. in the results with more than one substep. */
  enabled: boolean;
  substep: number;
  total: number;
  /** The scene of the substep is shown (false: it failed; undefined: loading). */
  shown: boolean | undefined;
  onStep: (substep: number) => void;
}

export interface Player {
  playing: boolean;
  toggle: () => void;
  speed: Speed;
  setSpeed: (speed: Speed) => void;
  /** The substeps to load ahead (none unless playing). */
  ahead: readonly number[];
}

const NONE: readonly number[] = [];

export function usePlayer({
  enabled,
  substep,
  total,
  shown,
  onStep,
}: Options): Player {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(DEFAULT_SPEED);
  const step = useRef(onStep);
  step.current = onStep;
  // the time of the last step
  const last = useRef(0);

  const active = playing && enabled;
  useEffect(() => {
    if (!enabled) setPlaying(false);
  }, [enabled]);
  // a scene that cannot be shown stops playing
  useEffect(() => {
    if (active && shown === false) setPlaying(false);
  }, [active, shown]);

  useEffect(() => {
    if (!active || !shown) return;
    const wait = Math.max(0, 1000 / speed - (performance.now() - last.current));
    const timer = setTimeout(() => {
      last.current = performance.now();
      step.current(nextSubstep(substep, total));
    }, wait);
    return () => clearTimeout(timer);
  }, [active, shown, substep, total, speed]);

  const ahead = useRef<{ key: string; list: readonly number[] } | undefined>(
    undefined,
  );
  const key = `${substep}/${total}`;
  if (!active) ahead.current = undefined;
  else if (ahead.current?.key !== key) {
    ahead.current = { key, list: substepsAhead(substep, total, AHEAD) };
  }

  return {
    playing: active,
    toggle: () => {
      if (!enabled) return;
      last.current = performance.now();
      // from a substep that failed, play on with the next one
      if (!active && shown === false) step.current(nextSubstep(substep, total));
      setPlaying(!active);
    },
    speed,
    setSpeed,
    ahead: ahead.current?.list ?? NONE,
  };
}
