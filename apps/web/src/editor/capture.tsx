/* eslint-disable react-refresh/only-export-components -- Its components are drawn off screen, never hot-reloaded in place. */
import { type Catalog, type DesignDocument, IN, wallLabel } from '@ezd/core';
import type Konva from 'konva';
import { type Ref, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Layer, Rect, Stage } from 'react-konva';

import { contentBounds } from '../store/selectors';
import { elevationModel } from './elevation/model';
import { encodeRgbPng, pngDataUrl } from './png';
import { ElevationDrawing } from './elevation/ElevationDrawing';
import {
  CountertopsLayer,
  DimensionsLayer,
  FloorLayer,
  ItemsLayer,
  OpeningsLayer,
  WallsLayer,
} from './plan/layers';
import { fitBounds, type Size, type Viewport } from './viewport';

// The drawings of a quote: the plan and each wall's elevation as PNG images, drawn off
// screen from the document alone, so nothing selected, hovered or dragged shows. They are
// drawn at a fixed size and pixel ratio, so the same document gives the same images on any
// screen. 800 px across a 7 1/2 in wide page makes the 11 px labels about 7 pt.

export const PLAN_SIZE: Size = { width: 800, height: 520 };
export const ELEVATION_SIZE: Size = { width: 800, height: 400 };
export const PIXEL_RATIO = 2;

export type Drawings = {
  plan: string;
  elevations: { wallId: string; label: string; image: string }[];
};

const NO_SEVERITIES = new Map();

function transform(viewport: Viewport) {
  return {
    x: viewport.offsetX,
    y: viewport.offsetY,
    scaleX: viewport.scale / IN,
    scaleY: viewport.scale / IN,
    listening: false,
  };
}

/** A white page under the drawing, so the image is not transparent. */
const Paper = ({ size }: { size: Size }) => (
  <Layer listening={false}>
    <Rect width={size.width} height={size.height} fill="#ffffff" />
  </Layer>
);

function Drawing({
  doc,
  catalog,
  wallId,
  stageRef,
  onReady,
}: {
  doc: DesignDocument;
  catalog: Catalog;
  /** An elevation of this wall, or the plan when null. */
  wallId: string | null;
  stageRef: Ref<Konva.Stage>;
  onReady(): void;
}) {
  useEffect(onReady, [onReady]);
  if (wallId === null) {
    const viewport = fitBounds(contentBounds(doc, { kind: 'plan' }), PLAN_SIZE);
    return (
      <Stage ref={stageRef} {...PLAN_SIZE} listening={false}>
        <Paper size={PLAN_SIZE} />
        <Layer {...transform(viewport)}>
          <FloorLayer doc={doc} />
          <WallsLayer doc={doc} />
          <OpeningsLayer doc={doc} />
          <CountertopsLayer doc={doc} />
          <ItemsLayer
            doc={doc}
            severities={NO_SEVERITIES}
            viewport={viewport}
            draggedId={undefined}
          />
          <DimensionsLayer doc={doc} selected={undefined} viewport={viewport} />
        </Layer>
      </Stage>
    );
  }
  const model = elevationModel(doc, catalog, wallId);
  const viewport = fitBounds(contentBounds(doc, { kind: 'elevation', wallId }), ELEVATION_SIZE);
  return (
    <Stage ref={stageRef} {...ELEVATION_SIZE} listening={false}>
      <Paper size={ELEVATION_SIZE} />
      <Layer {...transform(viewport)}>
        {model && (
          <ElevationDrawing
            model={model}
            selection={[]}
            severities={NO_SEVERITIES}
            draggedId={undefined}
            dragging={false}
            viewport={viewport}
          />
        )}
      </Layer>
    </Stage>
  );
}

/** The drawing on a white page, as an RGB PNG with no alpha channel (see png.ts). */
async function opaquePng(source: HTMLCanvasElement): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The drawing could not be made.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  return pngDataUrl(await encodeRgbPng(canvas.width, canvas.height, data));
}

/** Draws one view in a detached container and reads it back as a PNG data URL. */
async function capture(doc: DesignDocument, catalog: Catalog, wallId: string | null) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none';
  document.body.append(container);
  const root = createRoot(container);
  try {
    let stage: Konva.Stage | null = null;
    await new Promise<void>((resolve) => {
      root.render(
        <Drawing
          doc={doc}
          catalog={catalog}
          wallId={wallId}
          stageRef={(node) => {
            stage = node;
          }}
          onReady={resolve}
        />,
      );
    });
    // The Konva tree is built in the commit that the effect above follows; one frame lets
    // react-konva finish attaching the shapes.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (!stage) throw new Error('The drawing could not be made.');
    return opaquePng((stage as Konva.Stage).toCanvas({ pixelRatio: PIXEL_RATIO }));
  } finally {
    root.unmount();
    container.remove();
  }
}

/** The plan and the elevation of every wall, in document order. */
export async function captureDrawings(doc: DesignDocument, catalog: Catalog): Promise<Drawings> {
  const plan = await capture(doc, catalog, null);
  const elevations: Drawings['elevations'] = [];
  for (const wall of doc.room.walls) {
    elevations.push({
      wallId: wall.id,
      label: wallLabel(doc, wall.id),
      image: await capture(doc, catalog, wall.id),
    });
  }
  return { plan, elevations };
}
