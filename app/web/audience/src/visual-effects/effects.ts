import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
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
  end(runtimeMs: number): void;
}
interface Run {
  options: EffectOptions;
  target: Object3D;
  handle: EffectHandle;
  sample(time: number): boolean;
  release(): void;
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

  play(input: EffectOptions, target: Object3D, completed?: () => void): EffectHandle {
    if (input.effectId === "handGlow") throw new Error("Use begin for handGlow");
    return this.start(input, target, completed);
  }
  begin(input: EffectOptions, target: Object3D, completed?: () => void): HandGlowHandle {
    if (input.effectId !== "handGlow") throw new Error("begin requires handGlow");
    return this.start(input, target, completed) as HandGlowHandle;
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
      sample(time: number): boolean;
      release(): void;
    } =
      options.effectId === "wave"
        ? this.wave(options, target)
        : options.effectId === "dissolve"
          ? this.dissolve(options, target)
          : this.hand(options, target, handle);
    run = {
      options,
      target,
      handle: implementation.handle ?? handle,
      sample: implementation.sample,
      release: implementation.release,
      completed,
    };
    this.runs.set(options.runId, run);
    return run.handle;
  }
  private wave(options: EffectOptions, target: Object3D) {
    const group = new Group();
    group.visible = false;
    group.scale.setScalar(options.size);
    target.add(group);
    const blue = new Color("#7187f5");
    const purple = new Color("#9a80d0");
    const coral = new Color("#df7b80");
    const shade = new Color();
    const phase = -Math.PI * 0.2 + ((options.seed % 1024) / 1023) * Math.PI * 0.1;
    const lines = Array.from({ length: 12 }, () => {
      const item = line(options, 96);
      item.geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(96 * 3), 3));
      item.material.vertexColors = true;
      group.add(item);
      return item;
    });
    return {
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
            colors.setXYZ(i, shade.r, shade.g, shade.b);
          }
          item.geometry.setDrawRange(0, Math.max(2, Math.ceil(p * 95) + 1));
          positions.needsUpdate = true;
          colors.needsUpdate = true;
          item.geometry.computeBoundingSphere();
          const appear = Math.max(0, Math.min(1, p / 0.22));
          item.material.opacity = options.color[3] * appear * appear * (3 - 2 * appear);
        });
        return false;
      },
      release: () => releaseGroup(group),
    };
  }
  private hand(options: EffectOptions, target: Object3D, base: EffectHandle) {
    const group = new Group();
    group.visible = false;
    target.add(group);
    const glow = new Mesh(
      new SphereGeometry(0.025 * options.size, 12, 8),
      new MeshBasicMaterial({
        color: color(options),
        transparent: true,
        opacity: options.color[3],
        depthWrite: false,
      }),
    );
    const trail = line(options, 64);
    group.add(glow, trail);
    const samples: { position: Vector3; at: number }[] = [];
    let ended: number | undefined;
    let released = false;
    const handle: HandGlowHandle = {
      cancel: base.cancel,
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
        if (samples.length > 64) samples.shift();
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
        glow.visible = ended === undefined || now < ended;
        if (active.length) glow.position.copy(active[active.length - 1]!.position);
        const positions = trail.geometry.getAttribute("position");
        active.forEach((s, i) => positions.setXYZ(i, s.position.x, s.position.y, s.position.z));
        trail.geometry.setDrawRange(0, active.length);
        positions.needsUpdate = true;
        trail.geometry.computeBoundingSphere();
        trail.material.opacity =
          options.color[3] * (ended === undefined ? 1 : Math.max(0, 1 - (now - ended) / lifetime));
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
      if (!(object instanceof Mesh)) return;
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
          shader.uniforms.visualSeed = { value: options.seed % 65536 };
          shader.uniforms.visualSize = { value: options.size };
          shader.uniforms.visualColor = { value: color(options) };
          shader.vertexShader =
            "varying vec3 visualPosition;\n" +
            shader.vertexShader.replace(
              "#include <begin_vertex>",
              "#include <begin_vertex>\nvisualPosition = position;",
            );
          shader.fragmentShader =
            "varying vec3 visualPosition;\nuniform float visualDissolve;\nuniform float visualSeed;\nuniform float visualSize;\nuniform vec3 visualColor;\n" +
            shader.fragmentShader.replace(
              "#include <alphatest_fragment>",
              `#include <alphatest_fragment>
float visualNoise = fract(sin(dot(floor(visualPosition / visualSize * 35.0), vec3(12.9898,78.233,45.164)) + visualSeed) * 43758.5453);
if (visualDissolve >= 1.0 || (visualDissolve > 0.0 && visualNoise < visualDissolve)) discard;
if (visualDissolve > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, visualColor, 1.0 - smoothstep(0.0, 0.06, visualNoise - visualDissolve));`,
            );
        };
        clone.customProgramCacheKey = () => "unframe-visual-dissolve-v1";
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
