import { simplify } from "points-on-curve";

import { getSizeFromPoints, isTransparent } from "@excalidraw/common";
import {
  bezierEquation,
  curveCatmullRomCubicApproxPoints,
  curveClosestParameter,
  curveIntersectLineSegment,
  distanceToLineSegment,
  lineSegment,
  lineSegmentIntersectionPoints,
  pointDistance,
  pointFrom,
  pointRotateRads,
} from "@excalidraw/math";

import type { Curve, GlobalPoint, LocalPoint } from "@excalidraw/math";

import { elementCenterPoint, getElementLineSegments } from "./bounds";
import { getLinearElementCenterline } from "./bucketFill";
import {
  newArrowElement,
  newFreeDrawElement,
  newLinearElement,
} from "./newElement";
import { isArrowElement, isLineElement } from "./typeChecks";
import { isPathALoop } from "./utils";

import type { Point } from "points-on-curve";

import type { ElementsMap, NonDeletedExcalidrawElement } from "./types";

const EPSILON = 1e-5;
type CutGesture = {
  start: GlobalPoint;
  end: GlobalPoint | null;
  tolerance: number;
};

const projection = (point: GlobalPoint, a: GlobalPoint, b: GlobalPoint) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return (
    ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)
  );
};

const interpolate = (a: GlobalPoint, b: GlobalPoint, t: number) =>
  pointFrom<GlobalPoint>(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);

const splitPath = (points: readonly GlobalPoint[], gesture: CutGesture) => {
  let best:
    | { index: number; t: number; point: GlobalPoint; distance: number }
    | undefined;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    if (pointDistance(a, b) < EPSILON) {
      continue;
    }
    const intersection = gesture.end
      ? lineSegmentIntersectionPoints(
          lineSegment(a, b),
          lineSegment(gesture.start, gesture.end),
        )
      : interpolate(
          a,
          b,
          Math.max(0, Math.min(1, projection(gesture.start, a, b))),
        );
    if (!intersection) {
      continue;
    }
    const distance = pointDistance(intersection, gesture.start);
    if (
      (!gesture.end && distance > gesture.tolerance) ||
      (best && distance >= best.distance)
    ) {
      continue;
    }
    best = {
      index,
      t: projection(intersection, a, b),
      point: intersection,
      distance,
    };
  }

  if (!best) {
    return null;
  }

  return splitPathAt(points, best.index, best.t, best.point);
};

const splitPathAt = (
  points: readonly GlobalPoint[],
  index: number,
  t: number,
  point: GlobalPoint,
) => {
  const left = points.slice(0, index + 1);
  const right = points.slice(index + 1);
  const appendLeft = pointDistance(left[left.length - 1], point) >= EPSILON;
  const prependRight = pointDistance(right[0], point) >= EPSILON;
  if (appendLeft) {
    left.push(point);
  }
  if (prependRight) {
    right.unshift(point);
  }

  if (left.length < 2 || right.length < 2) {
    return null;
  }
  return { left, right, index, t, appendLeft, prependRight };
};

/**
 * Use the native spline for hit testing and retain its original edit points.
 * A single extra point per side near the cut can preserve a bend that would
 * otherwise disappear when the native renderer refits the shorter spline.
 */
const splitRoundedPath = (points: GlobalPoint[], gesture: CutGesture) => {
  // RoughJS uses the default Catmull–Rom tangents at zero curve tightness.
  const curves = curveCatmullRomCubicApproxPoints(points)!;
  const blade = gesture.end ? lineSegment(gesture.start, gesture.end) : null;
  let best:
    | { index: number; t: number; point: GlobalPoint; distance: number }
    | undefined;
  for (const [index, segment] of curves.entries()) {
    const clickT = blade
      ? 0
      : curveClosestParameter(segment, gesture.start, EPSILON);
    const hits = blade
      ? curveIntersectLineSegment(segment, blade, {
          tolerance: EPSILON,
          iterLimit: 16,
        })
      : [segment[0], bezierEquation(segment, clickT), segment[3]];
    // A crossing directly at a knot may be just outside Newton's interval.
    if (blade) {
      for (const knot of [segment[0], segment[3]]) {
        if (distanceToLineSegment(knot, blade) < EPSILON) {
          hits.push(knot);
        }
      }
    }
    for (const hit of hits) {
      const distance = pointDistance(hit, gesture.start);
      if (
        (!blade && distance > gesture.tolerance) ||
        (best && distance >= best.distance)
      ) {
        continue;
      }
      const t =
        pointDistance(hit, segment[0]) < EPSILON
          ? 0
          : pointDistance(hit, segment[3]) < EPSILON
          ? 1
          : blade
          ? curveClosestParameter(segment, hit, EPSILON)
          : clickT;
      best = {
        index,
        t,
        point: t === 0 ? segment[0] : t === 1 ? segment[3] : hit,
        distance,
      };
    }
  }
  if (!best) {
    return null;
  }

  const { index, t, point } = best;
  const pieces = splitPathAt(points, index, t, point);
  if (!pieces) {
    return null;
  }

  const addBend = (
    segment: Curve<GlobalPoint>,
    from: number,
    to: number,
    otherEnd: GlobalPoint,
    path: GlobalPoint[],
    insertionIndex: number,
  ) => {
    const chord = lineSegment(point, otherEnd);
    // Try both ends of the interval. An S-shaped segment can cross its chord
    // in the middle even when the surrounding curve visibly departs from it.
    const earlier = bezierEquation(segment, (2 * from + to) / 3);
    const later = bezierEquation(segment, (from + 2 * to) / 3);
    const earlierDeviation = distanceToLineSegment(earlier, chord);
    const laterDeviation = distanceToLineSegment(later, chord);
    if (Math.max(earlierDeviation, laterDeviation) > 0.25) {
      path.splice(
        insertionIndex,
        0,
        earlierDeviation > laterDeviation ? earlier : later,
      );
    }
  };
  const { left, right, appendLeft, prependRight } = pieces;
  addBend(
    curves[appendLeft ? index : index - 1],
    0,
    appendLeft ? t : 1,
    left[left.length - 2],
    left,
    left.length - 1,
  );
  addBend(
    curves[prependRight ? index : index + 1],
    prependRight ? t : 0,
    1,
    right[1],
    right,
    1,
  );
  return pieces;
};

/** Split a ring with exactly two crossings so each side is one editable polygon. */
const splitRing = (
  ring: readonly GlobalPoint[],
  start: GlobalPoint,
  end: GlobalPoint,
  simplifyOutline: boolean,
) => {
  const length = pointDistance(start, end);
  if (length < EPSILON) {
    return null;
  }
  const dx = (end[0] - start[0]) / length;
  const dy = (end[1] - start[1]) / length;
  const side = (point: GlobalPoint) =>
    dx * (point[1] - start[1]) - dy * (point[0] - start[0]);
  const left: GlobalPoint[] = [];
  const right: GlobalPoint[] = [];
  const crossings: GlobalPoint[] = [];
  let hasLeft = false;
  let hasRight = false;

  for (let i = 0; i < ring.length; i++) {
    const point = ring[i];
    const next = ring[(i + 1) % ring.length];
    const d = side(point);
    const nextD = side(next);

    if (d >= -EPSILON) {
      left.push(point);
    }
    if (d <= EPSILON) {
      right.push(point);
    }
    hasLeft ||= d > EPSILON;
    hasRight ||= d < -EPSILON;

    if (Math.abs(d) <= EPSILON) {
      crossings.push(point);
    } else if (
      (d > EPSILON && nextD < -EPSILON) ||
      (d < -EPSILON && nextD > EPSILON)
    ) {
      const crossing = interpolate(point, next, d / (d - nextD));
      crossings.push(crossing);
      left.push(crossing);
      right.push(crossing);
    }
  }

  if (
    !hasLeft ||
    !hasRight ||
    crossings.length !== 2 ||
    crossings.some((point) => {
      const t = projection(point, start, end);
      return t < -EPSILON || t > 1 + EPSILON;
    })
  ) {
    return null;
  }

  return [left, right].map((points) => {
    if (!simplifyOutline) {
      return [...points, points[0]];
    }
    // Put the two ends of the new seam at the ends of the open outline
    // before simplifying so both are kept exactly where the blade crossed.
    const first = points.indexOf(crossings[0]);
    const second = points.indexOf(crossings[1]);
    const startIndex = (first + 1) % points.length === second ? second : first;
    const outline = [
      ...points.slice(startIndex),
      ...points.slice(0, startIndex),
    ];
    const compact = simplify(outline as unknown as Point[], 0.5).map(([x, y]) =>
      pointFrom<GlobalPoint>(x, y),
    );
    const retained = compact.length >= 3 ? compact : outline;
    return [...retained, retained[0]];
  });
};

const shapeOutline = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
) => {
  const center = elementCenterPoint(element, elementsMap);
  const points = getElementLineSegments(element, elementsMap).flatMap(
    (segment) => [...segment],
  );
  // Shape sides and rounded corners are returned separately. These primitives
  // are convex, so ordering their outline samples about the center joins them.
  points.sort(
    (a, b) =>
      Math.atan2(a[1] - center[1], a[0] - center[0]) -
      Math.atan2(b[1] - center[1], b[0] - center[0]),
  );
  return points.filter(
    (point, i) =>
      pointDistance(point, points[(i + points.length - 1) % points.length]) >=
      EPSILON,
  );
};

export const cutElement = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
  gesture: CutGesture,
): NonDeletedExcalidrawElement[] | null => {
  if (
    element.locked ||
    element.boundElements?.length ||
    element.opacity === 0
  ) {
    return null;
  }

  const style = {
    strokeColor: element.strokeColor,
    backgroundColor: element.backgroundColor,
    strokeWidth: element.strokeWidth,
    strokeStyle: element.strokeStyle,
    fillStyle: element.fillStyle,
    opacity: element.opacity,
    roughness: element.roughness,
    seed: element.seed,
    groupIds: element.groupIds,
    frameId: element.frameId,
    link: element.link,
    customData: element.customData,
  };
  const makeGeometry = (points: GlobalPoint[]) => {
    const [x, y] = points[0];
    return {
      ...style,
      ...getSizeFromPoints(points),
      x,
      y,
      points: points.map((point) =>
        pointFrom<LocalPoint>(point[0] - x, point[1] - y),
      ),
    };
  };

  const filled = !isTransparent(element.backgroundColor);
  if (
    element.type === "rectangle" ||
    element.type === "diamond" ||
    element.type === "ellipse" ||
    (isLineElement(element) &&
      (element.polygon || (filled && isPathALoop(element.points))))
  ) {
    if (!gesture.end) {
      return null;
    }
    const points =
      element.type === "line"
        ? getLinearElementCenterline(element, elementsMap)
        : shapeOutline(element, elementsMap);
    const ring =
      points.length > 1 &&
      pointDistance(points[0], points[points.length - 1]) < EPSILON
        ? points.slice(0, -1)
        : points;
    const pieces = splitRing(
      ring,
      gesture.start,
      gesture.end,
      element.roundness != null || element.type === "ellipse",
    );
    return (
      pieces?.map((piece) =>
        newLinearElement({
          ...makeGeometry(piece),
          type: "line",
          polygon: true,
        }),
      ) ?? null
    );
  }

  if (
    element.type !== "line" &&
    element.type !== "arrow" &&
    element.type !== "freedraw"
  ) {
    return null;
  }
  if (
    isArrowElement(element) &&
    (element.elbowed || element.startBinding || element.endBinding)
  ) {
    return null;
  }
  if (
    isTransparent(element.strokeColor) ||
    (element.type === "freedraw" && filled && isPathALoop(element.points))
  ) {
    return null;
  }

  const center = elementCenterPoint(element, elementsMap);
  const points = element.points.map((point) =>
    pointRotateRads(
      pointFrom<GlobalPoint>(element.x + point[0], element.y + point[1]),
      center,
      element.angle,
    ),
  );
  const pieces =
    element.type !== "freedraw" && element.roundness && points.length > 2
      ? splitRoundedPath(points, gesture)
      : splitPath(points, gesture);
  if (!pieces) {
    return null;
  }

  const halves = [pieces.left, pieces.right].map((points) => ({
    ...makeGeometry(points),
    roundness: element.roundness,
  }));
  if (element.type === "freedraw") {
    const { index, t, appendLeft, prependRight } = pieces;
    const pressures = [[], []] as [number[], number[]];
    if (element.pressures.length === points.length) {
      const pressure =
        element.pressures[index] +
        (element.pressures[index + 1] - element.pressures[index]) * t;
      pressures[0] = element.pressures.slice(0, index + 1);
      pressures[1] = element.pressures.slice(index + 1);
      if (appendLeft) {
        pressures[0].push(pressure);
      }
      if (prependRight) {
        pressures[1].unshift(pressure);
      }
    }

    return halves.map((geometry, i) =>
      newFreeDrawElement({
        ...geometry,
        type: "freedraw",
        strokeOptions: element.strokeOptions,
        simulatePressure: element.simulatePressure,
        pressures: pressures[i],
      }),
    );
  }
  if (element.type === "arrow") {
    return halves.map((geometry, i) =>
      newArrowElement({
        ...geometry,
        type: "arrow",
        startArrowhead: i === 0 ? element.startArrowhead : null,
        endArrowhead: i === 1 ? element.endArrowhead : null,
      }),
    );
  }
  return halves.map((geometry) =>
    newLinearElement({ ...geometry, type: "line" }),
  );
};
