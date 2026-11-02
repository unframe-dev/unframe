import type { OpaqueBinding } from "./bindings.js";

export type OpaqueCaptureRequest = {
  readonly javascript: string;
  readonly stylesheets: readonly string[];
  readonly assets: readonly {
    readonly path: string;
    readonly mediaType: string;
    readonly dataBase64: string;
  }[];
  readonly props: Readonly<Record<string, string | number | boolean>>;
  readonly texts: Readonly<Record<string, string>>;
  readonly expectedBindings: Readonly<Record<string, string>>;
  readonly bindingKeys?: readonly string[];
  readonly buttonBindings?: Readonly<Record<string, boolean>>;
  readonly stateId: string;
  readonly stateKey?: string;
  readonly logicalSize: readonly [number, number];
  readonly pixelTarget: readonly [number, number];
  readonly background: readonly [number, number, number, number];
  readonly colorScheme: "light" | "dark";
};
export type OpaqueCaptureResult =
  | {
      readonly ok: true;
      readonly rgbaBase64: string;
      readonly pixelSize: readonly [number, number];
      readonly bindings: readonly OpaqueBinding[];
      readonly browserVersion: string;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly generatedLocations?: readonly { readonly line: number; readonly column: number }[];
    };
