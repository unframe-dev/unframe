import type { OpaqueBinding } from "./bindings.js";

export type OpaqueCaptureRequest = {
  readonly assets: ReadonlyArray<{
    readonly dataBase64: string;
    readonly mediaType: string;
    readonly path: string;
  }>;
  readonly background: readonly [number, number, number, number];
  readonly bindingKeys?: ReadonlyArray<string>;
  readonly buttonBindings?: Readonly<Record<string, boolean>>;
  readonly colorScheme: "light" | "dark";
  readonly expectedBindings: Readonly<Record<string, string>>;
  readonly javascript: string;
  readonly logicalSize: readonly [number, number];
  readonly pixelTarget: readonly [number, number];
  readonly props: Readonly<Record<string, string | number | boolean>>;
  readonly stateId: string;
  readonly stateKey?: string;
  readonly stylesheets: ReadonlyArray<string>;
  readonly texts: Readonly<Record<string, string>>;
};
export type OpaqueCaptureResult =
  | {
      readonly bindings: ReadonlyArray<OpaqueBinding>;
      readonly browserVersion: string;
      readonly ok: true;
      readonly pixelSize: readonly [number, number];
      readonly rgbaBase64: string;
    }
  | { readonly code: string; readonly ok: false };
