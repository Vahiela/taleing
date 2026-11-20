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
