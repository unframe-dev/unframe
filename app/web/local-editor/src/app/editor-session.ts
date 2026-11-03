type SessionIdentity = {
  token: string;
  readOnly: boolean;
  target: HTMLElement;
  close(): void;
};

export function reuseEditorSession<T extends SessionIdentity>(
  previous: T | undefined,
  token: string | null,
  target: HTMLElement,
  readOnly: boolean,
): T | null {
  if (!previous) return null;
  if (
    (!token || token === previous.token) &&
    previous.target === target &&
    previous.readOnly === readOnly
  )
    return previous;
  previous.close();
  return null;
}
