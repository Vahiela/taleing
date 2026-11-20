import { getSizeFromPoints, isTransparent } from "@excalidraw/common";
import {
  lineSegment,
  lineSegmentIntersectionPoints,
  pointDistance,
  pointFrom,
  pointRotateRads,
} from "@excalidraw/math";

import type { GlobalPoint, LocalPoint } from "@excalidraw/math";

import { elementCenterPoint, getElementLineSegments } from "./bounds";
import { getLinearElementCenterline } from "./bucketFill";
import {
  newArrowElement,
  newFreeDrawElement,
  newLinearElement,
} from "./newElement";
import { isArrowElement, isLineElement } from "./typeChecks";
import { isPathALoop } from "./utils";

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

  const { index, t, point } = best;
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

/** Split a ring with exactly two crossings so each side is one editable polygon. */
const splitRing = (
  ring: readonly GlobalPoint[],
  start: GlobalPoint,
  end: GlobalPoint,
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

  return [left, right].map((points) => [...points, points[0]]);
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
    const pieces = splitRing(ring, gesture.start, gesture.end);
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
  const points =
    element.type === "freedraw"
      ? element.points.map((point) =>
          pointRotateRads(
            pointFrom<GlobalPoint>(element.x + point[0], element.y + point[1]),
            center,
            element.angle,
          ),
        )
      : getLinearElementCenterline(element, elementsMap);
  const pieces = splitPath(points, gesture);
  if (!pieces) {
    return null;
  }

  const halves = [makeGeometry(pieces.left), makeGeometry(pieces.right)];
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
