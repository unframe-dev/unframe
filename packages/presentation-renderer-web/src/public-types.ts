export type FixedBrowserEnvironment = {
  readonly browser: {
    readonly id: string;
    readonly version: string;
    readonly fontFingerprint: string;
  };
  readonly locale: string;
  readonly timezone: string;
  readonly colorSpace: "srgb";
  readonly deviceScaleFactor: 1;
  readonly network: "deny";
  readonly filesystem: "deny";
  readonly clock: "fixed";
  readonly random: "fixed";
};

export type BrowserCaptureRequest = {
  readonly stateId: string;
  readonly document: string;
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
  readonly identity: {
    readonly id: string;
    readonly implementationHash: string;
  };
  readonly environment: FixedBrowserEnvironment;
  capture(
    request: BrowserCaptureRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<BrowserRgbaCapture> | BrowserRgbaCapture;
};

export type FixedBrowserSession = FixedBrowserAdapter & {
  close(): Promise<void>;
};

export type WebRendererConfig = {
  readonly documentBackground: readonly [red: number, green: number, blue: number, alpha: number];
  readonly fontFamily: string;
};

export type CreateBakedWebRendererOptions = {
  readonly adapter: FixedBrowserAdapter;
  readonly config: WebRendererConfig;
};
