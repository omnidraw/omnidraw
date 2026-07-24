import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasProductTransformProposal } from "../../engine/product-runtime/typed";
import { fnElementTransformPatch } from "../../semantic/fn.transform-proposal";

function fnScalePoints(
  points: readonly (readonly [number, number])[],
  scaleX: number,
  scaleY: number,
) {
  return points.map((point) => [
    point[0] * scaleX,
    point[1] * scaleY,
  ] as [number, number]);
}

function fnPersistWidgetTransformProposal(
  element: TElement,
  proposal: TCanvasProductTransformProposal,
  updatedAt: number,
): TElement {
  const previousScaleX = proposal.previousTransform.scale.x;
  const previousScaleY = proposal.previousTransform.scale.y;
  const relativeScaleX = previousScaleX === 0
    ? 1
    : proposal.nextTransform.scale.x / previousScaleX;
  const relativeScaleY = previousScaleY === 0
    ? 1
    : proposal.nextTransform.scale.y / previousScaleY;
  const localDelta = {
    x: proposal.nextTransform.position.x
      - proposal.previousTransform.position.x,
    y: proposal.nextTransform.position.y
      - proposal.previousTransform.position.y,
  };
  const elementScale = {
    x: element.scaleX ?? 1,
    y: element.scaleY ?? 1,
  };
  const rotationRadians = element.rotation * Math.PI / 180;
  const scaledDelta = {
    x: localDelta.x * elementScale.x,
    y: localDelta.y * elementScale.y,
  };
  const worldDelta = {
    x: scaledDelta.x * Math.cos(rotationRadians)
      - scaledDelta.y * Math.sin(rotationRadians),
    y: scaledDelta.x * Math.sin(rotationRadians)
      + scaledDelta.y * Math.cos(rotationRadians),
  };
  const next = {
    ...element,
    x: element.x + worldDelta.x,
    y: element.y + worldDelta.y,
    rotation: element.rotation
      + (
        proposal.nextTransform.rotationRadians
        - proposal.previousTransform.rotationRadians
      ) * 180 / Math.PI,
    scaleX: elementScale.x * relativeScaleX,
    scaleY: elementScale.y * relativeScaleY,
    updatedAt,
  };
  if (proposal.nextSize === undefined) {
    return next;
  }
  return {
    ...next,
    data: {
      ...element.data,
      w: proposal.nextSize.width,
      h: proposal.nextSize.height,
    },
  } as TElement;
}

export function fnPersistProductTransformProposal(
  element: TElement,
  proposal: TCanvasProductTransformProposal,
  updatedAt: number,
): TElement | null {
  if (
    element.data.type === "ui-widget"
    || element.data.type === "widget-instance"
  ) {
    return fnPersistWidgetTransformProposal(element, proposal, updatedAt);
  }
  const patch = fnElementTransformPatch(element, {
    target: proposal.target,
    position: proposal.nextTransform.position,
    rotationRadians: proposal.nextTransform.rotationRadians,
    scale: proposal.nextTransform.scale,
    ...(proposal.nextSize === undefined
      ? {}
      : { size: proposal.nextSize }),
  });
  if (patch === null) {
    return null;
  }

  const resized = proposal.nextSize !== undefined;
  const next = {
    ...element,
    x: patch.x,
    y: patch.y,
    rotation: patch.rotation,
    scaleX: resized ? 1 : patch.scaleX,
    scaleY: resized ? 1 : patch.scaleY,
    updatedAt,
  } satisfies TElement;

  if (proposal.nextSize === undefined) {
    return next;
  }
  const { width, height } = proposal.nextSize;
  const data = element.data;
  if (data.type === "rect" || data.type === "diamond") {
    return {
      ...next,
      data: {
        ...data,
        w: width,
        h: height,
        ...(data.text === undefined
          ? {}
          : {
              text: {
                ...data.text,
                w: width,
                h: height,
              },
            }),
      },
    };
  }
  if (data.type === "ellipse") {
    return {
      ...next,
      data: {
        ...data,
        rx: width / 2,
        ry: height / 2,
        ...(data.text === undefined
          ? {}
          : {
              text: {
                ...data.text,
                w: width,
                h: height,
              },
            }),
      },
    };
  }
  if (
    data.type === "text"
    || data.type === "image"
  ) {
    return {
      ...next,
      data: {
        ...data,
        w: width,
        h: height,
      },
    } as TElement;
  }
  if (
    (data.type === "line" || data.type === "arrow" || data.type === "pen")
    && proposal.previousSize !== undefined
  ) {
    const scaleX = proposal.previousSize.width === 0
      ? 1
      : width / proposal.previousSize.width;
    const scaleY = proposal.previousSize.height === 0
      ? 1
      : height / proposal.previousSize.height;
    return {
      ...next,
      data: {
        ...data,
        points: fnScalePoints(data.points, scaleX, scaleY),
      },
    } as TElement;
  }
  return next;
}
