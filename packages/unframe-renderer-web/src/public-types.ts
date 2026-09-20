import type * as z from "zod";

import type {
  adapterIdentitySchema,
  fixedBrowserEnvironmentSchema,
  webRendererConfigSchema,
} from "./validation/schemas.js";

type DeepReadonly<T> = T extends Uint8Array
  ? Uint8Array
  : T extends readonly unknown[]
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type FixedBrowserEnvironment = DeepReadonly<z.input<typeof fixedBrowserEnvironmentSchema>>;
export type BrowserCaptureRequest = {
  readonly stateId: string;
  readonly document: string;
  readonly fontFaceCount: number;
  readonly pixelTarget: readonly [width: number, height: number];
  readonly colorScheme: "light" | "dark";
  readonly environment: FixedBrowserEnvironment;
  readonly capabilities: Pick<
    FixedBrowserEnvironment,
    "network" | "filesystem" | "clock" | "random" | "deviceScaleFactor" | "colorSpace"
  >;
};

export type BrowserRgbaCapture = {
  readonly rgba: Uint8Array;
  readonly pixelSize: readonly [width: number, height: number];
  readonly colorSpace: "srgb";
  readonly alphaMode: "opaque" | "straight" | "premultiplied";
};

export type FixedBrowserAdapter = {
  readonly identity: DeepReadonly<z.input<typeof adapterIdentitySchema>>;
  readonly environment: FixedBrowserEnvironment;
  capture(
    request: BrowserCaptureRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<BrowserRgbaCapture> | BrowserRgbaCapture;
};

export type FixedBrowserSession = FixedBrowserAdapter & {
  close(): Promise<void>;
};

export type WebRendererConfig = DeepReadonly<z.input<typeof webRendererConfigSchema>>;

export type CreateBakedWebRendererOptions = {
  readonly adapter: FixedBrowserAdapter;
  readonly config: WebRendererConfig;
};
