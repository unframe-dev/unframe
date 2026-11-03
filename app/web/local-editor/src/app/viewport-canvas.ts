const canvases: WeakMap<object, HTMLCanvasElement> =
  import.meta.hot?.data.canvases ?? new WeakMap();

export function retainPreviewCanvas(owner: object, create: () => HTMLCanvasElement) {
  let canvas = canvases.get(owner);
  if (!canvas) {
    canvas = create();
    canvases.set(owner, canvas);
  }
  return canvas;
}

if (import.meta.hot) import.meta.hot.data.canvases = canvases;
