import {
  Euler,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { createTrackingAdapter } from "../../app/web/audience/src/tracking/adapter";
import type { FiducialFrame } from "../../app/web/audience/src/fiducials/frame-source";
import { loadBoardConfig } from "../../app/web/audience/src/fiducials/config";

const identity = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
};

export function createBrowserPlatform() {
  const rendering = {
    textures: 0,
    drawCalls: 0,
    texturedRenderers: 0,
    renderedOpacity: -1,
    renderedPixels: 0,
  };
  const factory: typeof createTrackingAdapter = (options) => {
    const telemetry = createTrackingAdapter(options);
    let renderer: WebGLRenderer | null = null;
    let cleanup: (() => void) | void;
    let frame = 0;
    let detection = false;
    let lastSample = -Infinity;
    let pixels = new Uint8Array();
    let frames = 0;
    return {
      async start() {
        if (renderer) return;
        const board = await loadBoardConfig();
        const scene = new Scene();
        const camera = new PerspectiveCamera(
          50,
          options.canvas.width / options.canvas.height,
          0.01,
          100,
        );
        renderer = new WebGLRenderer({
          canvas: options.canvas,
          antialias: false,
          preserveDrawingBuffer: true,
        });
        renderer.setSize(options.canvas.width, options.canvas.height, false);
        renderer.setClearColor(0x07090b);
        cleanup = options.callbacks.onScene(scene, camera, renderer);
        options.callbacks.onTracking("NORMAL");
        const render = (now: number) => {
          if (!renderer) return;
          if (detection && now - lastSample >= 100) {
            lastSample = now;
            const intrinsics = { fx: 500, fy: 500, cx: 320, cy: 240 };
            const cameraFromMarker = new Matrix4().compose(
              new Vector3(0.02, -0.01, -2),
              new Quaternion().setFromEuler(new Euler(0.35, -0.2, 0.1)),
              new Vector3(1, 1, 1),
            );
            const half = board.markers[0]!.sizeMeters / 2;
            const corners = [
              [-1, 1],
              [1, 1],
              [1, -1],
              [-1, -1],
            ].map(([x, y]) => {
              const p = new Vector3(x! * half, y! * half, 0).applyMatrix4(cameraFromMarker);
              return {
                x: intrinsics.cx + (intrinsics.fx * p.x) / -p.z,
                y: intrinsics.cy - (intrinsics.fy * p.y) / -p.z,
              };
            });
            const input: FiducialFrame = {
              id: now,
              timestampMs: now,
              sourceVideoTime: null,
              width: 640,
              height: 480,
              pixels: new Uint8Array(),
              intrinsics,
              worldFromCamera: identity,
            };
            options.callbacks.onDetections(input, {
              detections: [{ family: "tag36h11", id: 0, corners }],
              durationMs: 0,
            });
          }
          renderer.render(scene, camera);
          rendering.drawCalls += renderer.info.render.calls;
          rendering.textures = renderer.info.memory.textures;
          rendering.texturedRenderers = 0;
          const opacities: number[] = [];
          scene.traverseVisible((object) => {
            if (!(object instanceof Mesh)) return;
            for (const material of Array.isArray(object.material)
              ? object.material
              : [object.material]) {
              const uniforms: Record<string, { value: unknown }> =
                "uniforms" in material ? material.uniforms : {};
              const textured =
                ("map" in material && material.map instanceof Texture) ||
                Object.values(uniforms).some((uniform) => uniform.value instanceof Texture);
              if (textured) {
                rendering.texturedRenderers++;
                opacities.push(material.opacity);
              }
            }
          });
          rendering.renderedOpacity = opacities.length ? Math.min(...opacities) : -1;
          if (rendering.texturedRenderers > 0 && frames++ % 10 === 0) {
            const gl = renderer.getContext();
            const size = gl.drawingBufferWidth * gl.drawingBufferHeight * 4;
            if (pixels.length !== size) pixels = new Uint8Array(size);
            gl.readPixels(
              0,
              0,
              gl.drawingBufferWidth,
              gl.drawingBufferHeight,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              pixels,
            );
            rendering.renderedPixels = 0;
            for (let i = 0; i < pixels.length; i += 64)
              if (Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > 32)
                rendering.renderedPixels++;
          }
          frame = requestAnimationFrame(render);
        };
        frame = requestAnimationFrame(render);
      },
      stop() {
        cancelAnimationFrame(frame);
        cleanup?.();
        cleanup = undefined;
        renderer?.dispose();
        renderer = null;
        rendering.textures = 0;
        rendering.texturedRenderers = 0;
        rendering.renderedOpacity = -1;
        rendering.renderedPixels = 0;
        telemetry.stop();
      },
      async setDetectionEnabled(enabled) {
        detection = enabled;
        return true;
      },
      getMeasurementSnapshot() {
        const measured = telemetry.getMeasurementSnapshot();
        return {
          ...measured,
          startup: { ...measured.startup, phase: renderer ? "running" : "stopped" },
        };
      },
    };
  };
  return { createTrackingAdapter: factory, getRendering: () => ({ ...rendering }) };
}
