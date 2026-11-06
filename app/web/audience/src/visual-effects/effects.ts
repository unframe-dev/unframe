import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  Vector3,
  Vector4,
} from "three";

export interface EffectOptions {
  runId: string;
  effectId: "wave" | "handGlow" | "dissolve";
  size: number;
  color: readonly [number, number, number, number];
  speed: number;
  waveCycles?: number;
  durationMs: number;
  seed: number;
  startedAtRuntimeMs: number;
}
export interface EffectHandle {
  cancel(): void;
}
export interface HandGlowHandle extends EffectHandle {
  updatePose(position: Vector3, runtimeMs: number): void;
  clearPoses(): void;
  retarget(target: Object3D): void;
  end(runtimeMs: number): void;
}
interface Run {
  options: EffectOptions;
  target: Object3D;
  handle: EffectHandle;
  sample(time: number): boolean;
  release(): void;
  setOpacity?: ((opacity: number) => void) | undefined;
  completed?: (() => void) | undefined;
}
function time(value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid effect time");
}
function validate(options: EffectOptions): EffectOptions {
  if (!options.runId || !["wave", "handGlow", "dissolve"].includes(options.effectId))
    throw new Error("Invalid effect identity");
  for (const value of [options.size, options.speed, options.durationMs]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid effect parameter");
  }
  if (
    options.color.length !== 4 ||
    options.color.some((v) => !Number.isFinite(v) || v < 0 || v > 1)
  )
    throw new Error("Invalid effect color");
  if (!Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff)
    throw new Error("Invalid effect seed");
  const cycles = options.waveCycles ?? 1;
  if (!Number.isFinite(cycles) || cycles < 0 || cycles > 6) throw new Error("Invalid wave cycles");
  time(options.startedAtRuntimeMs);
  return {
    runId: options.runId,
    effectId: options.effectId,
    size: options.size,
    color: [...options.color],
    speed: options.speed,
    waveCycles: cycles,
    durationMs: options.durationMs,
    seed: options.seed,
    startedAtRuntimeMs: options.startedAtRuntimeMs,
  };
}
function color(options: EffectOptions): Color {
  return new Color().setRGB(options.color[0], options.color[1], options.color[2], SRGBColorSpace);
}
function progress(options: EffectOptions, now: number): number {
  return Math.max(
    0,
    Math.min(1, ((now - options.startedAtRuntimeMs) * options.speed) / options.durationMs),
  );
}
function line(options: EffectOptions, points: number): Line<BufferGeometry, LineBasicMaterial> {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(points * 3), 3));
  return new Line(
    geometry,
    new LineBasicMaterial({
      color: color(options),
      transparent: true,
      opacity: options.color[3],
      depthWrite: false,
    }),
  );
}
function ribbon(options: EffectOptions, capacity: number, width: number) {
  const geometry = new BufferGeometry();
  for (const attribute of ["position", "previous", "next"])
    geometry.setAttribute(attribute, new Float32BufferAttribute(new Float32Array(capacity * 6), 3));
  geometry.setAttribute(
    "side",
    new Float32BufferAttribute(
      Array.from({ length: capacity * 2 }, (_, i) => (i % 2 === 0 ? -1 : 1)),
      1,
    ),
  );
  geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(capacity * 8), 4));
  geometry.setIndex(
    Array.from({ length: (capacity - 1) * 6 }, (_, i) => {
      const start = Math.floor(i / 6) * 2;
      return start + [0, 1, 2, 2, 1, 3][i % 6]!;
    }),
  );
  geometry.setDrawRange(0, 0);
  const material = new MeshBasicMaterial({
    color: color(options),
    vertexColors: true,
    transparent: true,
    opacity: options.color[3],
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.visualHalfWidth = { value: width / 2 };
    shader.vertexShader =
      "attribute vec3 previous;\nattribute vec3 next;\nattribute float side;\nuniform float visualHalfWidth;\n" +
      shader.vertexShader.replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vec2 visualTangent = (modelViewMatrix * vec4(next - previous, 0.0)).xy;
float visualLength = length(visualTangent);
vec2 visualSide = visualLength > 0.000001 ? vec2(-visualTangent.y, visualTangent.x) / visualLength : vec2(1.0, 0.0);
mvPosition.xy += visualSide * side * visualHalfWidth;
gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  material.customProgramCacheKey = () => "unframe-hand-ribbon-v1";
  const mesh = new Mesh(geometry, material);
  function update(points: readonly Vector3[], fadeTail: boolean) {
    const positions = geometry.getAttribute("position");
    const previous = geometry.getAttribute("previous");
    const next = geometry.getAttribute("next");
    const colors = geometry.getAttribute("color");
    const distances = [0];
    for (let i = 1; i < points.length; i++)
      distances[i] = distances[i - 1]! + points[i]!.distanceTo(points[i - 1]!);
    const length = distances[points.length - 1] ?? 0;
    points.forEach((point, i) => {
      const before = points[Math.max(0, i - 1)]!;
      const after = points[Math.min(points.length - 1, i + 1)]!;
      const alpha = fadeTail ? (length > 0 ? distances[i]! / length : 0) : 1;
      for (let side = 0; side < 2; side++) {
        const vertex = i * 2 + side;
        positions.setXYZ(vertex, point.x, point.y, point.z);
        previous.setXYZ(vertex, before.x, before.y, before.z);
        next.setXYZ(vertex, after.x, after.y, after.z);
        colors.setXYZW(vertex, 1, 1, 1, alpha);
      }
    });
    for (const attribute of [positions, previous, next, colors]) attribute.needsUpdate = true;
    geometry.setDrawRange(0, Math.max(0, points.length - 1) * 6);
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) geometry.boundingSphere.radius += width / 2;
  }
  return { mesh, update };
}
function releaseGroup(group: Group): void {
  group.removeFromParent();
  group.traverse((object) => {
    if (object instanceof Mesh || object instanceof Line) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    }
  });
}

/** Engine-local API. Transport, authorization and presentation state belong to the caller. */
export class VisualEffects {
  private readonly runs = new Map<string, Run>();
  private readonly dissolveOwners = new Set<Mesh>();
  private readonly generatedMeshes = new WeakSet<Mesh>();

  play(input: EffectOptions, target: Object3D, completed?: () => void): EffectHandle {
    if (input.effectId === "handGlow") throw new Error("Use begin for handGlow");
    return this.start(input, target, completed);
  }
  begin(input: EffectOptions, target: Object3D, completed?: () => void): HandGlowHandle {
    if (input.effectId !== "handGlow") throw new Error("begin requires handGlow");
    return this.start(input, target, completed) as HandGlowHandle;
  }
  setWaveOpacity(runId: string, opacity: number): void {
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
      throw new Error("Invalid wave opacity");
    const run = this.runs.get(runId);
    if (!run?.setOpacity) throw new Error("Wave run not found");
    run.setOpacity(opacity);
  }
  evaluate(runtimeMs: number): void {
    time(runtimeMs);
    // Snapshot prevents completion callbacks from adding runs to this evaluation.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const run of [...this.runs.values()]) {
      if (this.runs.get(run.options.runId) !== run) continue;
      if (run.sample(runtimeMs)) {
        this.remove(run);
        run.completed?.();
      }
    }
  }
  dispose(): void {
    for (const run of this.runs.values()) this.remove(run);
  }
  private remove(run: Run): void {
    if (this.runs.get(run.options.runId) !== run) return;
    this.runs.delete(run.options.runId);
    run.release();
  }
  private start(input: EffectOptions, target: Object3D, completed?: () => void): EffectHandle {
    const options = validate(input);
    const previous = this.runs.get(options.runId);
    if (previous) {
      if (
        previous.target !== target ||
        JSON.stringify(previous.options) !== JSON.stringify(options)
      )
        throw new Error("Effect run ID reused with different parameters");
      return previous.handle;
    }
    if (this.runs.size >= 32) throw new Error("Effect capacity exceeded");
    let run: Run;
    const handle: EffectHandle = { cancel: () => this.remove(run) };
    const implementation: {
      handle?: EffectHandle;
      setOpacity?: (opacity: number) => void;
      sample(time: number): boolean;
      release(): void;
    } =
      options.effectId === "wave"
        ? this.wave(options, target)
        : options.effectId === "dissolve"
          ? this.dissolve(options, target)
          : this.hand(options, target, handle, (next) => {
              run.target = next;
            });
    run = {
      options,
      target,
      handle: implementation.handle ?? handle,
      sample: implementation.sample,
      setOpacity: implementation.setOpacity,
      release: implementation.release,
      completed,
    };
    this.runs.set(options.runId, run);
    return run.handle;
  }
  private wave(options: EffectOptions, target: Object3D) {
    let opacity = 1;
    const group = new Group();
    group.visible = false;
    group.scale.setScalar(options.size);
    target.add(group);
    const blue = new Color("#7187f5");
    const purple = new Color("#9a80d0");
    const coral = new Color("#df7b80");
    const shade = new Color();
    const phase = -Math.PI * 0.2 + ((options.seed % 1024) / 1023) * Math.PI * 0.1;
    const samples = 256;
    const lines = Array.from({ length: 12 }, () => {
      const item = line(options, samples);
      item.geometry.setAttribute(
        "color",
        new Float32BufferAttribute(new Float32Array(samples * 4), 4),
      );
      item.material.vertexColors = true;
      group.add(item);
      return item;
    });
    return {
      setOpacity(value: number) {
        opacity = value;
      },
      sample(now: number) {
        const p = progress(options, now);
        group.visible = now >= options.startedAtRuntimeMs;
        lines.forEach((item, lane) => {
          const positions = item.geometry.getAttribute("position");
          const colors = item.geometry.getAttribute("color");
          for (let i = 0; i < positions.count; i++) {
            // Fixed path samples retain their positions as the leading edge advances.
            const q = Math.min(i / (positions.count - 1), p);
            positions.setXYZ(
              i,
              -4 + 8 * q,
              0.6 * Math.cos(q * (options.waveCycles ?? 1) * Math.PI * 2 + phase) +
                (5.5 - lane) * 0.12,
              0,
            );
            if (q <= 0.48) shade.copy(blue).lerp(purple, q / 0.48);
            else shade.copy(purple).lerp(coral, (q - 0.48) / 0.52);
            const tip = Math.max(0, Math.min(1, (p - q) / 0.06));
            colors.setXYZW(i, shade.r, shade.g, shade.b, tip * tip * (3 - 2 * tip));
          }
          item.geometry.setDrawRange(0, Math.max(2, Math.ceil(p * (samples - 1)) + 1));
          positions.needsUpdate = true;
          colors.needsUpdate = true;
          item.geometry.computeBoundingSphere();
          const appear = Math.max(0, Math.min(1, p / 0.22));
          item.material.opacity = options.color[3] * appear * appear * (3 - 2 * appear) * opacity;
        });
        return false;
      },
      release: () => releaseGroup(group),
    };
  }
  private hand(
    options: EffectOptions,
    target: Object3D,
    base: EffectHandle,
    onRetarget: (target: Object3D) => void,
  ) {
    const group = new Group();
    group.visible = false;
    target.add(group);
    const halo = ribbon(options, 25, 0.012 * options.size);
    const trail = ribbon(options, 256, 0.025 * options.size);
    group.add(halo.mesh, trail.mesh);
    this.generatedMeshes.add(halo.mesh);
    this.generatedMeshes.add(trail.mesh);
    const samples: { position: Vector3; at: number }[] = [];
    let ended: number | undefined;
    let released = false;
    const handle: HandGlowHandle = {
      cancel: base.cancel,
      retarget(next) {
        next.add(group);
        onRetarget(next);
      },
      clearPoses() {
        samples.length = 0;
      },
      updatePose(position, at) {
        time(at);
        if (![position.x, position.y, position.z].every(Number.isFinite))
          throw new Error("Invalid hand position");
        if (released || ended !== undefined) return;
        if (
          at < options.startedAtRuntimeMs ||
          (samples.length && at < samples[samples.length - 1]!.at)
        )
          throw new Error("Hand time must be monotonic");
        samples.push({ position: position.clone(), at });
        if (samples.length > 256) samples.shift();
      },
      end(at) {
        time(at);
        if (
          at < options.startedAtRuntimeMs ||
          (samples.length && at < samples[samples.length - 1]!.at)
        )
          throw new Error("Invalid hand end time");
        if (ended === undefined) ended = at;
      },
    };
    return {
      handle,
      sample(now: number) {
        const lifetime = options.durationMs / options.speed;
        const active = samples.filter((s) => s.at <= now && now - s.at < lifetime);
        group.visible = now >= options.startedAtRuntimeMs && active.length > 0;
        const fade = ended === undefined ? 1 : Math.max(0, 1 - (now - ended) / lifetime);
        trail.update(
          active.map((sample) => sample.position),
          true,
        );
        if (active.length) {
          const center = active[active.length - 1]!.position;
          halo.update(
            Array.from({ length: 25 }, (_, i) => {
              const angle = (i / 24) * Math.PI * 2;
              return center
                .clone()
                .add(
                  new Vector3(Math.cos(angle), Math.sin(angle), 0).multiplyScalar(
                    0.035 * options.size,
                  ),
                );
            }),
            false,
          );
        }
        halo.mesh.material.opacity = trail.mesh.material.opacity = options.color[3] * fade;
        return ended !== undefined && now >= ended + lifetime;
      },
      release() {
        released = true;
        releaseGroup(group);
      },
    };
  }
  private dissolve(options: EffectOptions, target: Object3D) {
    const meshes: Mesh<BufferGeometry, MeshStandardMaterial | MeshStandardMaterial[]>[] = [];
    target.traverse((object) => {
      if (!(object instanceof Mesh) || this.generatedMeshes.has(object)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (
        "isSkinnedMesh" in object ||
        materials.some(
          (m) =>
            !(m instanceof MeshStandardMaterial) ||
            m.transparent ||
            m.opacity !== 1 ||
            m.alphaTest !== 0,
        )
      )
        throw new Error("Dissolve requires opaque static standard materials");
      if (this.dissolveOwners.has(object)) throw new Error("Dissolve target already owned");
      meshes.push(object as Mesh<BufferGeometry, MeshStandardMaterial | MeshStandardMaterial[]>);
    });
    if (!meshes.length) throw new Error("Dissolve target has no meshes");
    const amount = { value: 0 };
    const records = meshes.map((mesh) => {
      const original = mesh.material;
      const castShadow = mesh.castShadow;
      mesh.castShadow = false;
      const materials = Array.isArray(original) ? original : [original];
      const clones = materials.map((material) => {
        const clone = material.clone();
        clone.onBeforeCompile = (shader) => {
          shader.uniforms.visualDissolve = amount;
          shader.uniforms.visualSeed = { value: options.seed % 10000 };
          shader.uniforms.visualNoiseScale = { value: 12 / options.size };
          const edgeColor = color(options);
          shader.uniforms.visualColor = {
            value: new Vector4(edgeColor.r, edgeColor.g, edgeColor.b, options.color[3]),
          };
          shader.vertexShader =
            "varying vec3 visualPosition;\n" +
            shader.vertexShader.replace(
              "#include <begin_vertex>",
              "#include <begin_vertex>\nvisualPosition = position;",
            );
          shader.fragmentShader =
            `varying vec3 visualPosition;
uniform float visualDissolve;
uniform float visualSeed;
uniform float visualNoiseScale;
uniform vec4 visualColor;
float visualHash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719)) + visualSeed) * 43758.5453);
}
float visualNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(visualHash(i), visualHash(i + vec3(1,0,0)), f.x), mix(visualHash(i + vec3(0,1,0)), visualHash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(visualHash(i + vec3(0,0,1)), visualHash(i + vec3(1,0,1)), f.x), mix(visualHash(i + vec3(0,1,1)), visualHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
` +
            shader.fragmentShader
              .replace(
                "#include <alphatest_fragment>",
                `#include <alphatest_fragment>
float visualNoiseValue = visualNoise(visualPosition * visualNoiseScale);
if (visualDissolve >= 1.0 || (visualDissolve > 0.0 && visualNoiseValue < visualDissolve)) discard;`,
              )
              .replace(
                "#include <opaque_fragment>",
                `float visualEdge = visualDissolve > 0.0 ? 1.0 - smoothstep(0.0, 0.06, visualNoiseValue - visualDissolve) : 0.0;
outgoingLight += visualColor.rgb * visualEdge * visualColor.a;
#include <opaque_fragment>`,
              );
        };
        clone.customProgramCacheKey = () => "unframe-visual-dissolve-v2";
        return clone;
      });
      mesh.material = Array.isArray(original) ? clones : clones[0]!;
      this.dissolveOwners.add(mesh);
      return { mesh, original, clones, castShadow };
    });
    return {
      sample(now: number) {
        amount.value = progress(options, now);
        return amount.value >= 1;
      },
      release: () => {
        for (const { mesh, original, clones, castShadow } of records) {
          mesh.material = original;
          mesh.castShadow = castShadow;
          clones.forEach((m) => m.dispose());
          this.dissolveOwners.delete(mesh);
        }
      },
    };
  }
}
