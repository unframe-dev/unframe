import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "151.0.7922.34";
export const SOURCE_DIR = join(dirname(fileURLToPath(import.meta.url)), "chromium");
export const MAX_INPUT_BYTES = 1024 * 1024;
export const HASHES: Record<string, string> = {
  common: "f5dc4129ade7d9e8ed5f53f19bb7f7594057cb69c82881e9615cbd4434a27e23",
  renderer: "43643636106bf2c497c849deae87981935a8b8137b5e5af6824b79ed34b53f4a",
  gpu: "28fad81d85942f09282d18948b482ebdd96fbce74f80f4cd3d7b725027ff2d5b",
  network: "ba07080bbb294ec05e680e687665fa35195ff3353ccec4b11c368dfebc1ae619",
};
type Form = string | Form[];
type Config = { readRoots: string[]; scratch: string; browser: string; helper: string };
const set = (value: string) => new Set(value.split(" "));
// Only the pinned call graph is admitted; effect return values must be unobserved.
const FUNCTIONS = set(
  "param-true? param-defined? user-homedir-path allow-font-access maybe-disable-metal-shader-cache maybe-allow-metal-shader-cache-access allow-cvms-blobs browser-service-name string-prefix? strip-leading-chars loop",
);
const EFFECT_FUNCTIONS = set(
  "allow-font-access allow-cvms-blobs maybe-allow-metal-shader-cache-access loop",
);
const EXPRESSION_HEADS = new Set([
  ...set(
    "version if when begin param string=? string? string->number number->string string-append string-length substring equal? regex-quote not and < >= - + debug literal path subpath prefix regex extension extension-class require-all require-any target vnode-type global-name iokit-registry-entry-class iokit-user-client-class iokit-connection iokit-property ipc-posix-name xpc-service-name xpc-service-name-regex sysctl-name sysctl-name-prefix sysctl-name-regex control-name remote local socket-domain socket-protocol",
  ),
  ...FUNCTIONS,
]);
const OPERATIONS = set(
  "signal process-info-pidinfo process-info-setcontrol sysctl-read file-read* file-read-data file-read-metadata file-read-xattr file-map-executable file-write* file-write-data file-write-unlink file-write-create file-write-owner file-ioctl mach-lookup iokit-open ipc-posix-shm ipc-posix-shm-read-data process-exec network-outbound network-inbound network-bind system-socket file* file-issue-extension user-preference-read iokit-get-properties iokit-set-properties sysctl-write",
);
const DENY_OPERATIONS = new Set([
  ...OPERATIONS,
  ...set("default process-info* nvram* distributed-notification-post"),
]);
function invalid(message: string): never {
  throw new Error(message);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function splitRule(value: Form[]) {
  const operations: string[] = [],
    rest: Form[][] = [];
  for (const item of value.slice(1)) {
    if (typeof item === "string" && !rest.length) operations.push(item);
    else if (Array.isArray(item) && item.length) rest.push(item);
    else invalid("unsupported rule grammar");
  }
  if (!operations.length) invalid("unsupported rule grammar");
  const modifiers = rest.filter((item) => item[0] === "with");
  if (modifiers.some((item) => !same(item, ["with", "no-log"])))
    invalid("unsupported rule modifier");
  return { operations, filters: rest.filter((item) => item[0] !== "with"), modifiers };
}
export function validate(forms: Form[]) {
  function expression(value: Form): void {
    if (typeof value === "string") return;
    const head = value[0];
    if (typeof head !== "string") invalid("unsupported expression");
    if (head === "allow" || head === "deny") {
      if (
        same(value, ["deny", "file-read*", "metal-cache-dir"]) ||
        same(value, ["deny", "file-write*", "metal-cache-dir"])
      )
        return;
      const { operations, filters } = splitRule(value);
      if (operations.some((op) => !(head === "allow" ? OPERATIONS : DENY_OPERATIONS).has(op)))
        invalid("unsupported operation");
      filters.forEach(expression);
    } else if (head === "define") {
      if (value.length < 3) invalid("invalid definition");
      const signature = value[1];
      if (Array.isArray(signature)) {
        if (
          typeof signature[0] !== "string" ||
          !FUNCTIONS.has(signature[0]) ||
          signature.some((item) => typeof item !== "string")
        )
          invalid("unsupported function definition");
      } else if (typeof signature !== "string") invalid("unsupported definition");
      value.slice(2).forEach(expression);
    } else if (head === "let") {
      const offset = typeof value[1] === "string" ? 2 : 1;
      if (offset === 2 && value[1] !== "loop") invalid("unsupported named let");
      const bindings = value[offset];
      if (!Array.isArray(bindings)) invalid("invalid let bindings");
      for (const binding of bindings) {
        if (!Array.isArray(binding) || binding.length !== 2 || typeof binding[0] !== "string")
          invalid("invalid binding");
        expression(binding[1]!);
      }
      value.slice(offset + 1).forEach(expression);
    } else if (EXPRESSION_HEADS.has(head)) {
      if (head === "if" && value.length !== 3 && value.length !== 4) invalid("invalid if");
      if (head === "when" && value.length < 3) invalid("invalid when");
      value.slice(1).forEach(expression);
    } else invalid("unsupported form: " + head);
  }
  forms.forEach(expression);
  auditAllowResults(forms);
}
function auditAllowResults(forms: Form[]) {
  function sequence(values: Form[], used: boolean) {
    values.forEach((value, index) => expression(value, used && index === values.length - 1));
  }
  function expression(value: Form, used: boolean): void {
    if (!Array.isArray(value) || !value.length) return;
    const head = value[0];
    if (head === "allow" || (typeof head === "string" && EFFECT_FUNCTIONS.has(head))) {
      if (used) invalid("allow return value is observed");
      value.slice(1).forEach((child) => expression(child, true));
    } else if (head === "define") {
      const signature = value[1];
      sequence(
        value.slice(2),
        !Array.isArray(signature) || !EFFECT_FUNCTIONS.has(signature[0] as string),
      );
    } else if (head === "let") {
      const offset = typeof value[1] === "string" ? 2 : 1;
      for (const binding of value[offset] as Form[][]) expression(binding[1]!, true);
      sequence(value.slice(offset + 1), used);
    } else if (head === "if" || head === "when") {
      expression(value[1]!, true);
      if (head === "when") sequence(value.slice(2), used);
      else value.slice(2).forEach((branch) => expression(branch, used));
    } else if (head === "begin") sequence(value.slice(1), used);
    else value.slice(1).forEach((child) => expression(child, true));
  }
  forms.forEach((form) => expression(form, false));
}
// Python's ensure_ascii spelling remains valid Seatbelt string syntax.
export const quote = (value: string): string =>
  JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"),
  );
const lexical = (a: string, b: string) => {
  const aa = Array.from(a, (char) => char.codePointAt(0)!);
  const bb = Array.from(b, (char) => char.codePointAt(0)!);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++)
    if (aa[i] !== bb[i]) return aa[i]! - bb[i]!;
  return aa.length - bb.length;
};
const pathOrder = (a: string, b: string) => {
  const aa = a.split("/"),
    bb = b.split("/");
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    const order = lexical(aa[i]!, bb[i]!);
    if (order) return order;
  }
  return aa.length - bb.length;
};
export function checkedConfig(value: unknown): Config {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !same(Object.keys(value).sort(), ["browser", "helper", "readRoots", "scratch"])
  )
    invalid("invalid preparation input");
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.readRoots) || input.readRoots.length > 512)
    invalid("invalid read roots");
  const broad = set(
    "/ /Users /System /Library /private /private/tmp /tmp /nix /nix/store /usr /var",
  );
  function path(item: unknown): string {
    if (
      typeof item !== "string" ||
      /[\ud800-\udfff]/u.test(item) ||
      Buffer.byteLength(item) < 1 ||
      Buffer.byteLength(item) > 4096
    )
      invalid("invalid path type or size");
    // eslint-disable-next-line no-control-regex -- Reject control characters at the path boundary.
    if (!item.startsWith("/") || /[\x00-\x1f\x7f]/.test(item))
      invalid("absolute path without control characters required");
    if (
      item.includes("//") ||
      item.split("/").some((part) => part === "." || part === "..") ||
      item.endsWith("/")
    )
      invalid("normalized absolute path required");
    if (broad.has(item) || /^\/Users\/[^/]+$/.test(item))
      invalid("global path is not a snapshot root");
    return item;
  }
  const roots = (input.readRoots as unknown[]).map(path);
  const scratch = path(input.scratch),
    browser = path(input.browser),
    helper = path(input.helper);
  const browserDirectory = path(posix.dirname(browser));
  if (!/^\/nix\/store\/[^/]+\//.test(helper)) invalid("helper must be pinned in the Nix store");
  roots.push(
    browserDirectory,
    "/System/Library",
    "/usr/lib",
    "/System/Cryptexes/OS/System/Library/dyld",
    "/System/Volumes/Preboot/Cryptexes/OS/System/Library/dyld",
  );
  return { readRoots: [...new Set(roots)].sort(pathOrder), scratch, browser, helper };
}
// Python whitespace includes information separators, but excludes the BOM.
const whitespace = (char: string) =>
  // eslint-disable-next-line no-control-regex -- Preserve Python's exact whitespace character set.
  /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/.test(
    char,
  );
export function parse(source: string): Form[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < source.length) {
    if (whitespace(source[i]!)) i++;
    else if (source[i] === ";") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end + 1;
    } else if (source[i] === "(" || source[i] === ")") tokens.push(source[i++]!);
    else if (source[i] === '"' || source.startsWith('#"', i)) {
      const start = i;
      i += source[i] === "#" ? 2 : 1;
      let closed = false;
      while (i < source.length) {
        if (source[i] === "\\") i += 2;
        else if (source[i] === '"') {
          tokens.push(source.slice(start, ++i));
          closed = true;
          break;
        } else i++;
      }
      if (!closed) invalid("unterminated string");
    } else {
      const start = i;
      while (i < source.length && !whitespace(source[i]!) && !'();"'.includes(source[i]!)) i++;
      if (i === start) invalid("invalid token");
      tokens.push(source.slice(start, i));
    }
  }
  let index = 0;
  function expression(): Form {
    if (index >= tokens.length) invalid("unexpected EOF");
    const token = tokens[index++]!;
    if (token === ")") invalid("unexpected close");
    if (token !== "(") return token;
    const result: Form[] = [];
    while (index < tokens.length && tokens[index] !== ")") result.push(expression());
    if (index >= tokens.length) invalid("unclosed expression");
    index++;
    return result;
  }
  const forms: Form[] = [];
  while (index < tokens.length) forms.push(expression());
  return forms;
}
export const render = (value: Form): string =>
  Array.isArray(value) ? "(" + value.map(render).join(" ") + ")" : value;
const disjunction = (filters: Form[]): Form =>
  filters.length === 1 ? filters[0]! : ["require-any", ...filters];
const literal = (path: string): Form => ["literal", quote(path)];
function floorFor(
  operation: string,
  readRoots: string[],
  scratch: string,
  bootstrapExec: string | null,
): Form | boolean {
  const read = disjunction([
    ...readRoots.map((p) => ["subpath", quote(p)]),
    ["subpath", quote(scratch)],
    ...["/dev/null", "/dev/random", "/dev/urandom"].map(literal),
  ]);
  if (operation === "file-read-metadata") {
    const ancestors = new Set<string>();
    for (const root of [...readRoots, scratch]) {
      let parent = posix.dirname(root);
      for (;;) {
        ancestors.add(parent);
        if (parent === "/") break;
        parent = posix.dirname(parent);
      }
    }
    return disjunction([read, ...[...ancestors].sort(lexical).map(literal)]);
  }
  if (set("file-read* file-read-data file-read-xattr file-map-executable").has(operation))
    return read;
  if (
    set(
      "file-write* file-write-data file-write-unlink file-write-create file-write-owner file-ioctl",
    ).has(operation)
  )
    return disjunction([["subpath", quote(scratch)], literal("/dev/null")]);
  if (operation === "mach-lookup")
    return disjunction(
      [...set("com.apple.system.logger com.apple.logd com.apple.system.notification_center")]
        .map((name) => ["global-name", quote(name)])
        .concat([["browser-service-name", '"MachPortRendezvousServer"']]),
    );
  if (operation === "iokit-open")
    return disjunction([
      ["iokit-registry-entry-class", '"IOSurfaceRootUserClient"'],
      ["iokit-registry-entry-class", '"RootDomainUserClient"'],
      ["iokit-user-client-class", '"IOSurfaceSendRight"'],
    ]);
  if (operation === "ipc-posix-shm" || operation === "ipc-posix-shm-read-data")
    return ["ipc-posix-name", '"apple.shm.notification_center"'];
  if (set("signal process-info-pidinfo process-info-setcontrol").has(operation))
    return ["target", "self"];
  if (operation === "sysctl-read") return true;
  if (operation === "process-exec" && bootstrapExec) return literal(bootstrapExec);
  if (
    set(
      "process-exec network-outbound network-inbound network-bind system-socket file* file-issue-extension user-preference-read iokit-get-properties iokit-set-properties sysctl-write",
    ).has(operation)
  )
    return false;
  return invalid("unsupported capability: " + operation);
}
export function transform(value: Form, config: Config): Form {
  if (!Array.isArray(value) || !value.length) return value;
  if (typeof value[0] === "string" && set("include import eval load").has(value[0]))
    invalid("unsupported form");
  if (value[0] !== "allow") return value.map((child) => transform(child, config));
  const { operations, filters, modifiers } = splitRule(value);
  const result: Form[] = operations.map((operation) => {
    const floor = floorFor(operation, config.readRoots, config.scratch, config.browser);
    if (floor === false) return "#t";
    if (floor === true) return ["allow", operation, ...filters, ...modifiers];
    return [
      "allow",
      operation,
      filters.length ? ["require-all", disjunction(filters), floor] : floor,
      ...modifiers,
    ];
  });
  return result.length === 1 ? result[0]! : ["begin", ...result];
}
export function canonical(source: string): Buffer {
  return Buffer.from(
    source
      // eslint-disable-next-line no-control-regex -- Preserve Python splitlines information separators.
      .split(/\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/)
      .map((line) => {
        let end = line.length;
        while (end && whitespace(line[end - 1]!)) end--;
        return line.slice(0, end);
      })
      .filter((line) => line && !line.startsWith(";"))
      .map((line) => line + "\n")
      .join(""),
  );
}
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const decode = (data: Buffer) =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
export function sources(directory = SOURCE_DIR): Record<string, string> {
  const manifest = JSON.parse(decode(readFileSync(join(directory, "manifest.json"))));
  if (
    manifest.version !== VERSION ||
    !same(Object.entries(manifest.sha256 ?? {}).sort(), Object.entries(HASHES).sort())
  )
    invalid("fixed source manifest mismatch");
  const result: Record<string, string> = {};
  for (const [name, expected] of Object.entries(HASHES)) {
    const data = readFileSync(join(directory, name + ".sb"));
    if (hash(data) !== expected) invalid("fixed source hash mismatch: " + name);
    result[name] = decode(data);
  }
  for (const role of ["renderer", "gpu", "network"])
    validate(parse(result.common! + result[role]!));
  return result;
}
function rootProfile(config: Config): string {
  const read = floorFor("file-read*", config.readRoots, config.scratch, null) as Form;
  const write = floorFor("file-write*", config.readRoots, config.scratch, null) as Form;
  const metadata = floorFor("file-read-metadata", config.readRoots, config.scratch, null) as Form;
  const forms: Form[] = [
    ["version", "1"],
    ["deny", "default"],
    ["allow", "file-read*", "file-test-existence", literal("/")],
    ["allow", "file-read*", "file-map-executable", read],
    ["allow", "file-read-metadata", metadata],
    ["allow", "file-write*", write],
    ["allow", "process-fork"],
    ["allow", "process-exec", literal(config.browser)],
    ["allow", "process-exec", literal(config.helper), ["with", "no-sandbox"]],
    ["allow", "sysctl-read"],
    ["allow", "iokit-open", floorFor("iokit-open", [], config.scratch, null) as Form],
    [
      "allow",
      "mach-lookup",
      ...[
        "com.apple.system.logger",
        "com.apple.logd",
        "com.apple.system.notification_center",
        "com.apple.bsd.dirhelper",
      ].map((name) => ["global-name", quote(name)]),
    ],
    ["allow", "ipc-posix-shm-read-data", ["ipc-posix-name", '"apple.shm.notification_center"']],
    [
      "allow",
      "mach-register",
      [
        "global-name",
        [
          "string-append",
          '"org.chromium.Chromium.MachPortRendezvousServer."',
          ["param", '"UNFRAME_BROWSER_PID"'],
        ],
      ],
    ],
  ];
  return forms.map(render).join("\n") + "\n";
}
export function prepare(value: unknown): Record<string, string | number | Record<string, string>> {
  const config = checkedConfig(value),
    fixed = sources();
  const result: Record<string, string | number | Record<string, string>> = {
    version: 4,
    root: rootProfile(config),
    sourceHashes: Object.fromEntries(
      Object.entries(fixed).map(([name, source]) => [name, hash(canonical(source))]),
    ),
  };
  for (const role of ["renderer", "gpu", "network"]) {
    const output = parse(fixed.common! + fixed[role]!).map((form) => transform(form, config));
    // libignition opens root while resolving dyld; this never grants descendants.
    output.push(["allow", "file-read*", "file-test-existence", literal("/")]);
    result[role] = output.map(render).join("\n") + "\n";
  }
  return result;
}
export function packagePolicies(destination: string, header: string) {
  const fixed = sources();
  mkdirSync(destination, { recursive: true });
  mkdirSync(dirname(header), { recursive: true });
  const lines = [
    "/* Generated by compile-policy.ts; do not edit. */",
    "#pragma once",
    "#define UNFRAME_DARWIN_POLICY_VERSION 4",
    '#define UNFRAME_CHROMIUM_VERSION "' + VERSION + '"',
  ];
  for (const [name, source] of Object.entries(fixed)) {
    const data = canonical(source);
    writeFileSync(join(destination, name + ".sb"), data);
    lines.push("#define UNFRAME_CHROMIUM_" + name.toUpperCase() + '_SHA256 "' + hash(data) + '"');
  }
  writeFileSync(header, lines.join("\n") + "\n");
}
function main(): void {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "package" && args.length === 5 && args[1] === "--out" && args[3] === "--header")
      packagePolicies(args[2]!, args[4]!);
    else if (args.length === 1 && args[0] === "prepare") {
      const data = Buffer.alloc(MAX_INPUT_BYTES + 1);
      let size = 0;
      // Bound stdin before decoding or parsing untrusted preparation data.
      while (size < data.length) {
        const count = readSync(0, data, size, data.length - size, null);
        if (!count) break;
        size += count;
      }
      if (size > MAX_INPUT_BYTES) invalid("preparation input too large");
      process.stdout.write(
        JSON.stringify(prepare(JSON.parse(decode(data.subarray(0, size))))) + "\n",
      );
    } else invalid("expected prepare or package --out <directory> --header <file>");
  } catch (error) {
    console.error("policy compilation failed: " + String(error));
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
