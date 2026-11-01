export const createChromiumLease = <T extends { close(): Promise<void> }>(ready: Promise<T>) => {
  let closing: Promise<void> | undefined;
  return {
    ready,
    close: () => (closing ??= ready.then((context) => context.close())),
  };
};
