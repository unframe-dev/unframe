import type * as z from "zod";

import type {
  adapterIdentitySchema,
  fixedBrowserEnvironmentSchema,
  webRendererConfigSchema,
} from "./validation/schemas.js";

type DeepReadonly<T> = T extends Uint8Array
  ? Uint8Array
  : T extends ReadonlyArray<unknown>
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type FixedBrowserEnvironment = DeepReadonly<z.input<typeof fixedBrowserEnvironmentSchema>>;
export type BrowserCaptureRequest = {
  readonly capabilities: Pick<
    FixedBrowserEnvironment,
    "network" | "filesystem" | "clock" | "random" | "deviceScaleFactor" | "colorSpace"
  >;
  readonly colorScheme: "light" | "dark";
  readonly document: string;
  readonly environment: FixedBrowserEnvironment;
  readonly fontFaceCount: number;
  readonly pixelTarget: readonly [width: number, height: number];
  readonly stateId: string;
};

export type BrowserRgbaCapture = {
  readonly alphaMode: "opaque" | "straight" | "premultiplied";
  readonly colorSpace: "srgb";
  readonly pixelSize: readonly [width: number, height: number];
  readonly rgba: Uint8Array;
};

export type FixedBrowserAdapter = {
  capture(
    request: BrowserCaptureRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<BrowserRgbaCapture> | BrowserRgbaCapture;
  readonly environment: FixedBrowserEnvironment;
  readonly identity: DeepReadonly<z.input<typeof adapterIdentitySchema>>;
};

export type FixedBrowserSession = FixedBrowserAdapter & {
  close(): Promise<void>;
};

export type WebRendererConfig = DeepReadonly<z.input<typeof webRendererConfigSchema>>;

export type CreateBakedWebRendererOptions = {
  readonly adapter: FixedBrowserAdapter;
  readonly config: WebRendererConfig;
};
