export const nativeHost = (platform: string = process.platform, arch: string = process.arch) => {
  if (platform === "linux" && arch === "x64")
    return { os: "linux", arch: "x64", browserCommand: "xdg-open", cgroup: true } as const;
  if (platform === "darwin" && arch === "arm64")
    return { os: "darwin", arch: "arm64", browserCommand: "open", cgroup: false } as const;
  throw new Error(`Unsupported native host: ${platform}/${arch}`);
};
