import { ROUNDNESS } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";
import { describe, expect, it } from "vitest";

import type { GlobalPoint, LocalPoint, Radians } from "@excalidraw/math";

import { cutElement } from "../src/cut";
import {
  newArrowElement,
  newElement,
  newFreeDrawElement,
  newLinearElement,
} from "../src/newElement";
import {
  isArrowElement,
  isFreeDrawElement,
  isLineElement,
} from "../src/typeChecks";

import type { ElementsMap, NonDeletedExcalidrawElement } from "../src/types";

const local = (x: number, y: number) => pointFrom<LocalPoint>(x, y);
const global = (x: number, y: number) => pointFrom<GlobalPoint>(x, y);
const style = {
  x: 20,
  y: 20,
  strokeColor: "#e03131",
  backgroundColor: "#ffc9c9",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 85,
} as const;

const cut = (
  element: NonDeletedExcalidrawElement,
  start: GlobalPoint,
  end: GlobalPoint | null = null,
) =>
  cutElement(element, new Map([[element.id, element]]) as ElementsMap, {
    start,
    end,
    tolerance: 7,
  });

describe("cutElement", () => {
  it("cuts a rotated line on its visible path", () => {
    const line = newLinearElement({
      ...style,
      type: "line",
      width: 100,
      height: 0,
      angle: (Math.PI / 2) as Radians,
      points: [local(0, 0), local(100, 0)],
    });
    const pieces = cut(line, global(70, 20));
    expect(pieces).toHaveLength(2);
    const [first, second] = pieces!;
    expect(first.x).toBeCloseTo(70);
    expect(first.y).toBeCloseTo(-30);
    expect(second.x).toBeCloseTo(70);
    expect(second.y).toBeCloseTo(20);
    expect(first.height).toBeCloseTo(50);
    expect(second.height).toBeCloseTo(50);
    expect(cut(line, global(70, -30))).toBeNull();
  });

  it.each(["click", "drag", "knot"] as const)(
    "preserves rounded edit points when cutting by %s",
    (gesture) => {
      const line = newLinearElement({
        ...style,
        type: "line",
        width: 160,
        height: 90,
        roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
        points: [local(0, 0), local(80, 90), local(160, 0)],
      });
      // Midpoint of the first native spline segment, away from its chord.
      const target = gesture === "knot" ? global(100, 110) : global(55, 70.625);
      const pieces =
        gesture === "drag"
          ? cut(line, global(target[0], 40), global(target[0], 95))
          : cut(line, target);
      expect(pieces).toHaveLength(2);
      const [first, second] = pieces!.filter(isLineElement);
      expect(first.roundness).toEqual(line.roundness);
      expect(second.roundness).toEqual(line.roundness);
      expect(first.points.length).toBeGreaterThanOrEqual(3);
      expect(first.points.length + second.points.length).toBeLessThanOrEqual(7);
      expect(second.x).toBeCloseTo(target[0], 2);
      expect(second.y).toBeCloseTo(target[1], 2);
      expect(first.x + first.points.at(-1)![0]).toBeCloseTo(second.x, 6);
      expect(first.y + first.points.at(-1)![1]).toBeCloseTo(second.y, 6);
    },
  );

  it.each(["rectangle", "diamond", "ellipse"] as const)(
    "splits a filled %s into closed, styled line polygons",
    (type) => {
      const shape = newElement({ ...style, type, width: 100, height: 60 });
      expect(cut(shape, global(70, 50), global(70, 100))).toBeNull();
      const pieces = cut(shape, global(70, 0), global(70, 100));
      expect(pieces).toHaveLength(2);
      for (const piece of pieces!) {
        expect(isLineElement(piece)).toBe(true);
        if (isLineElement(piece)) {
          expect(piece.polygon).toBe(true);
          expect(piece.points.at(-1)).toEqual(piece.points[0]);
          if (type === "ellipse") {
            expect(piece.points.length).toBeLessThan(24);
          }
          expect(Math.abs(piece.width - 50)).toBeLessThan(1);
        }
        expect(piece.backgroundColor).toBe(shape.backgroundColor);
        expect(piece.strokeColor).toBe(shape.strokeColor);
        expect(piece.opacity).toBe(shape.opacity);
      }
    },
  );

  it("keeps arrowheads at the original ends", () => {
    const arrow = newArrowElement({
      ...style,
      type: "arrow",
      points: [local(0, 0), local(100, 0)],
      startArrowhead: "circle",
      endArrowhead: "arrow",
    });
    const pieces = cut(arrow, global(70, 20))!.filter(isArrowElement);
    expect(
      pieces.map(({ startArrowhead, endArrowhead }) => [
        startArrowhead,
        endArrowhead,
      ]),
    ).toEqual([
      ["circle", null],
      [null, "arrow"],
    ]);
    expect(cut({ ...arrow, locked: true }, global(70, 20))).toBeNull();
  });

  it("interpolates pen pressure at the seam", () => {
    const stroke = newFreeDrawElement({
      ...style,
      type: "freedraw",
      points: [local(0, 0), local(100, 0)],
      pressures: [0.25, 0.75],
      simulatePressure: false,
    });
    const pieces = cut(stroke, global(70, 0), global(70, 40))!.filter(
      isFreeDrawElement,
    );
    expect(pieces.map(({ pressures }) => pressures)).toEqual([
      [0.25, 0.5],
      [0.5, 0.75],
    ]);
  });
});
