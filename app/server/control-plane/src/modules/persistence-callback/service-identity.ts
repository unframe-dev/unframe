const digest = async (value: string) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

const equal = (left: Uint8Array, right: Uint8Array) => {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
};

export class ServiceIdentity {
  constructor(private readonly secret: string) {}

  async authenticate(request: Request) {
    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    const [actual, expected] = await Promise.all([digest(token), digest(this.secret)]);
    return authorization?.startsWith("Bearer ") === true && equal(actual, expected);
  }
}
