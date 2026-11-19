// The pointer over the results (#312): the value under the pointer (#101, #140),
// and the minimum or the maximum that a click selects (#140).
import {
  type Dispatch,
  type StateUpdater,
  useEffect,
  useRef,
  useState,
} from "preact/hooks";
import type { Vec3 } from "../viewer/picking";
import { probeInfo } from "../viewer/probe";
import type { Viewer } from "../viewer/viewer";
import type { ResultScene } from "../worker/protocol";
import { type Extreme, extremeInfo, type Hover } from "./ResultsCards";

type ViewerRef = { current: Viewer | null };

/**
 * The selected minimum or maximum: a click on its marker selects it, a click
 * elsewhere into the view or Esc unselects it (#140). After the effect that makes
 * the viewer.
 */
export function usePinnedPick(
  viewer: ViewerRef,
  extremesShown: boolean,
  scene: ResultScene | undefined,
  [pinned, setPinned]: [
    Extreme | undefined,
    Dispatch<StateUpdater<Extreme | undefined>>,
  ],
) {
  const pinnedNow = useRef(pinned);
  pinnedNow.current = pinned;
  useEffect(() => {
    if (!extremesShown || !viewer.current) return;
    const off = viewer.current.onPick((_, click) => {
      const name = click.target?.startsWith("@")
        ? (click.target.slice(1) as Extreme)
        : undefined;
      setPinned((current) => (name && current !== name ? name : undefined));
    });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!pinnedNow.current) return;
      event.preventDefault();
      setPinned(undefined);
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      off();
      window.removeEventListener("keydown", escape, true);
    };
  }, [extremesShown, scene]);
}

/** A position of the pointer in a view of a size. */
interface At {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point displaced like the surfaces. */
const displaced = (
  position: readonly number[],
  displacement: readonly number[],
  scale: number,
) => position.map((x, k) => x + scale * displacement[k]) as Vec3;

/**
 * The value under the pointer: of the minimum or the maximum (#140), of a control
 * point (#101) or of the surface, with the ring of its point.
 */
function hoverAt(
  viewer: Viewer,
  scene: ResultScene,
  scale: number,
  { x, y, width, height }: At,
): Hover | undefined {
  const target = viewer.targetAt(x, y, width, height);
  const extreme =
    target === "@min" || target === "@max"
      ? scene.extremes?.[target.slice(1) as Extreme]
      : undefined;
  if (extreme) {
    // a ring at a node, the outlines of a cell are drawn already
    const ring =
      extreme.at === "point"
        ? viewer.project(
            displaced(extreme.position, extreme.displacement, scale),
            width,
            height,
          )
        : undefined;
    return {
      x,
      y,
      width,
      info: extremeInfo(scene, extreme),
      ...(ring ? { ring } : {}),
    };
  }
  const point = scene.points?.find((p) => p.name === target);
  if (point) {
    const position = displaced(point.position, point.displacement, scale);
    const ring = viewer.project(position, width, height);
    return { x, y, width, point, ring };
  }
  const probe = viewer.probeAt(x, y, width, height);
  if (!probe) return undefined;
  const info = probeInfo(scene, probe);
  const ring = info.atPoint
    ? viewer.project(probe.position, width, height)
    : undefined;
  return { x, y, width, info, ring };
}

/** The value under the pointer, once per frame; none while the view is moved. */
export function useHover(
  host: { current: HTMLDivElement | null },
  viewer: ViewerRef,
  scene: ResultScene | undefined,
  scale: number | undefined,
): Hover | undefined {
  const [hover, setHover] = useState<Hover>();
  useEffect(() => {
    setHover(undefined);
    const element = host.current;
    if (!element || !scene) return;
    let frame = 0;
    let last: { x: number; y: number } | undefined;
    const update = () => {
      frame = 0;
      const canvas = element.querySelector("canvas");
      if (!last || !canvas || !viewer.current) return;
      const { width, height } = canvas.getBoundingClientRect();
      const at = { ...last, width, height };
      setHover(hoverAt(viewer.current, scene, scale ?? 1, at));
    };
    const clear = () => {
      last = undefined;
      setHover(undefined);
    };
    const move = (event: PointerEvent) => {
      if (event.buttons) return clear();
      const rect = element.getBoundingClientRect();
      last = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      frame ||= requestAnimationFrame(update);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", clear);
    element.addEventListener("pointerdown", clear);
    element.addEventListener("wheel", clear, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", clear);
      element.removeEventListener("pointerdown", clear);
      element.removeEventListener("wheel", clear);
    };
  }, [scene, scale]);

  return hover;
}
