import type { describeTrackingInput } from "./raw-tracking";
import type { RigidPose } from "../fiducials/alignment";
import type { Camera, Scene } from "three";
import type { FrameRenderer, FrameSourceOptions, FiducialFrame } from "../fiducials/frame-source";
import type { DetectorResult } from "../fiducials/detector";
export interface CameraPipelineModule {
  name: string;
  onStart?: (value: {
    GLctx: WebGLRenderingContext | WebGL2RenderingContext;
    videoWidth: number;
    videoHeight: number;
    canvasWidth: number;
    canvasHeight: number;
  }) => void;
  onUpdate?: (value: {
    frameStartResult?: {
      videoTime?: number;
      repeatFrame?: boolean;
      textureWidth?: number;
      textureHeight?: number;
      orientation?: number;
    };
    processCpuResult?: {
      reality?: {
        trackingStatus?: unknown;
        trackingReason?: unknown;
        realityTexture?: WebGLTexture;
        intrinsics?: ArrayLike<number>;
        position?: RigidPose["position"];
        rotation?: RigidPose["rotation"];
      };
    };
  }) => void;
  onException?: (error: unknown) => void;
  onCanvasSizeChange?: (value: { canvasWidth: number; canvasHeight: number }) => void;
  onVideoSizeChange?: (value: { videoWidth: number; videoHeight: number }) => void;
  onDeviceOrientationChange?: (value: unknown) => void;
  onDetach?: () => void;
  listeners?: { event: string; process: (event: { detail: unknown }) => void }[];
}
export interface XrEngine {
  loadChunk(name: "slam"): Promise<void>;
  GlTextureRenderer: {
    pipelineModule(): CameraPipelineModule;
    create(options: Parameters<FrameSourceOptions["createRenderer"]>[0]): FrameRenderer;
  };
  Threejs: { pipelineModule(): CameraPipelineModule; xrScene(): { scene: Scene; camera: Camera } };
  XrController: {
    configure(options: { disableWorldTracking: boolean; scale: "absolute" }): void;
    pipelineModule(): CameraPipelineModule;
  };
  addCameraPipelineModules(modules: CameraPipelineModule[]): void;
  removeCameraPipelineModules(names: string[]): void;
  run(options: { canvas: HTMLCanvasElement }): void | Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
}
export interface SdkPoseSample {
  sessionId: number;
  callbackAtMs: number;
  sourceVideoTime: number | null;
  repeatFrame: boolean | null;
  sdkFromCamera: RigidPose | null;
  trackingStatus: "NORMAL" | "LIMITED";
  rawTracking?: ReturnType<typeof describeTrackingInput>;
  timestampBasis: "sdk-callback-performance-now";
  exposureSynchronization: "unknown";
}
export interface TrackingCallbacks {
  onPoseSample?(sample: SdkPoseSample): void;
  onScene(scene: Scene, camera: Camera): void | (() => void);
  onDetections(frame: FiducialFrame, result: DetectorResult): void;
  onTracking(status: "NORMAL" | "LIMITED"): void;
  onReset(reason: "hidden" | "tracking-lost" | "stopped"): void;
  onError(error: Error): void;
  onDiagnostic(event: string, detail: unknown): void;
}
