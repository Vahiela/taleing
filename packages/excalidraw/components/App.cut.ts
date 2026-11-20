import { viewportCoordsToSceneCoords } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  cutElement,
  getElementBounds,
  newElementWith,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { GlobalPoint } from "@excalidraw/math";

import type App from "./App";

type CutPointer = Pick<PointerEvent, "pointerId" | "clientX" | "clientY">;
const DRAG_THRESHOLD = 4;
const CLICK_TOLERANCE = 7;
const SVG_NS = "http://www.w3.org/2000/svg";

export class AppCut {
  constructor(private app: App) {}

  private pending: { pointer: CutPointer; start: GlobalPoint } | null = null;
  private preview: SVGSVGElement | null = null;

  private scenePoint(pointer: CutPointer) {
    const { x, y } = viewportCoordsToSceneCoords(pointer, this.app.state);
    return pointFrom<GlobalPoint>(x, y);
  }

  private isDrag(pointer: CutPointer, origin: CutPointer) {
    return (
      Math.hypot(
        pointer.clientX - origin.clientX,
        pointer.clientY - origin.clientY,
      ) >= DRAG_THRESHOLD
    );
  }

  handlePointerDown(event: CutPointer) {
    this.cancel();
    const { pointerId, clientX, clientY } = event;
    this.pending = {
      pointer: { pointerId, clientX, clientY },
      start: this.scenePoint(event),
    };
  }

  handlePointerMove(event: CutPointer) {
    const origin = this.pending?.pointer;
    if (!origin || event.pointerId !== origin.pointerId) {
      return;
    }
    if (!this.isDrag(event, origin)) {
      this.clearPreview();
      return;
    }

    const container = this.app.excalidrawContainerValue.container;
    if (!container) {
      return;
    }
    if (!this.preview) {
      const svg = this.app.ownerDocument.createElementNS(SVG_NS, "svg");
      const line = this.app.ownerDocument.createElementNS(SVG_NS, "line");
      svg.setAttribute("aria-hidden", "true");
      Object.assign(svg.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: "1",
      });
      line.setAttribute("stroke", "var(--color-primary, #6965db)");
      line.setAttribute("stroke-width", "2");
      line.setAttribute("stroke-dasharray", "5 4");
      svg.append(line);
      container.append(svg);
      this.preview = svg;
    }

    const { left, top } = container.getBoundingClientRect();
    const line = this.preview.firstElementChild!;
    line.setAttribute("x1", String(origin.clientX - left));
    line.setAttribute("y1", String(origin.clientY - top));
    line.setAttribute("x2", String(event.clientX - left));
    line.setAttribute("y2", String(event.clientY - top));
  }

  handlePointerUp(event: CutPointer) {
    const pending = this.pending;
    if (!pending || event.pointerId !== pending.pointer.pointerId) {
      return;
    }
    this.cancel();
    if (this.app.state.viewModeEnabled || !this.app.isInteractionEnabled()) {
      return;
    }

    const { start } = pending;
    const end = this.isDrag(event, pending.pointer)
      ? this.scenePoint(event)
      : null;
    const { editingGroupId, zoom } = this.app.state;
    const { scene } = this.app;
    const elementsMap = scene.getNonDeletedElementsMap();
    const elements = scene.getNonDeletedElements();
    const otherEnd = end ?? start;
    for (let i = elements.length - 1; i >= 0; i--) {
      const element = elements[i];
      if (editingGroupId && !element.groupIds.includes(editingGroupId)) {
        continue;
      }
      const tolerance = CLICK_TOLERANCE / zoom.value + element.strokeWidth / 2;
      const [x1, y1, x2, y2] = getElementBounds(element, elementsMap);
      if (
        Math.max(start[0], otherEnd[0]) < x1 - tolerance ||
        Math.min(start[0], otherEnd[0]) > x2 + tolerance ||
        Math.max(start[1], otherEnd[1]) < y1 - tolerance ||
        Math.min(start[1], otherEnd[1]) > y2 + tolerance
      ) {
        continue;
      }
      const pieces = cutElement(element, elementsMap, {
        start,
        end,
        tolerance,
      });
      if (!pieces) {
        continue;
      }

      this.app.updateScene({
        elements: scene
          .getElementsIncludingDeleted()
          .flatMap<ExcalidrawElement>((current) =>
            current.id === element.id
              ? [newElementWith(current, { isDeleted: true }), ...pieces]
              : [current],
          ),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      return;
    }
  }

  private clearPreview() {
    this.preview?.remove();
    this.preview = null;
  }

  cancel() {
    this.pending = null;
    this.clearPreview();
  }
}
