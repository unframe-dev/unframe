import { assert, describe, expect, it, vi } from "vite-plus/test";
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  ShaderLib,
  type WebGLRenderer,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { VisualEffects, type EffectOptions } from "../effects";

const options: EffectOptions = {
  runId: "a",
  effectId: "wave",
  size: 1,
  color: [0.3, 0.4, 1, 1],
  speed: 1,
  durationMs: 1000,
  seed: 2,
  startedAtRuntimeMs: 100,
};
describe("standalone visual effects", () => {
  it("uses external time, deduplicates active runs and completes once", () => {
    const effects = new VisualEffects();
    const material = new MeshStandardMaterial();
    const target = new Mesh(new BoxGeometry(), material);
    const dissolve = { ...options, effectId: "dissolve" as const };
    const done = vi.fn();
    const handle = effects.play(dissolve, target, done);
    expect(effects.play(dissolve, target)).toBe(handle);
    effects.evaluate(50);
    expect(done).not.toHaveBeenCalled();
    effects.evaluate(600);
    expect(target.material).not.toBe(material);
    effects.evaluate(1100);
    effects.evaluate(1200);
    expect(done).toHaveBeenCalledTimes(1);
    expect(target.material).toBe(material);
  });
  it("deduplicates independent property order and cleans up before completion callbacks", () => {
    const effects = new VisualEffects();
    const material = new MeshStandardMaterial();
    const target = new Mesh(new BoxGeometry(), material);
    const dissolve = { ...options, effectId: "dissolve" as const };
    const handle = effects.play(dissolve, target, () => {
      effects.play({ ...dissolve, startedAtRuntimeMs: 1100 }, target);
    });
    const { effectId, ...rest } = dissolve;
    const reordered = { effectId, ...rest };
    expect(effects.play(reordered, target)).toBe(handle);
    effects.evaluate(1100);
    expect(target.material).not.toBe(material);
    effects.dispose();
    effects.play(dissolve, target, () => {
      throw new Error("consumer failure");
    });
    expect(() => effects.evaluate(1100)).toThrow("consumer failure");
    expect(target.material).toBe(material);
  });
  it("rejects conflicting IDs and malformed values without allocating", () => {
    const effects = new VisualEffects();
    const target = new Group();
    expect(() => effects.play({ ...options, speed: 0 }, target)).toThrow();
    expect(() => effects.play({ ...options, color: [NaN, 0, 0, 1] }, target)).toThrow();
    effects.play(options, target);
    expect(() => effects.play({ ...options, size: 2 }, target)).toThrow();
    effects.dispose();
    expect(target.children).toHaveLength(0);
  });
  it("restores original materials and visibility after dissolve completion or cancellation", () => {
    const effects = new VisualEffects();
    const material = new MeshStandardMaterial();
    const mesh = new Mesh(new BoxGeometry(), material);
    const done = vi.fn();
    const handle = effects.play({ ...options, effectId: "dissolve" }, mesh, done);
    expect(mesh.material).not.toBe(material);
    handle.cancel();
    expect(mesh.material).toBe(material);
    expect(done).not.toHaveBeenCalled();
    effects.play({ ...options, effectId: "dissolve" }, mesh, () => {
      done();
      mesh.visible = false;
    });
    effects.evaluate(1100);
    expect(mesh.material).toBe(material);
    expect(mesh.visible).toBe(false);
    expect(done).toHaveBeenCalledTimes(1);
  });
  it("supplies the Unity noise scale, seed range and edge alpha to the dissolve shader", () => {
    const effects = new VisualEffects();
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    effects.play(
      { ...options, effectId: "dissolve", seed: 10042, size: 2, color: [1, 1, 1, 0.25] },
      mesh,
    );
    const shader = { ...ShaderLib.standard, uniforms: { ...ShaderLib.standard.uniforms } };
    mesh.material.onBeforeCompile(
      shader as Parameters<MeshStandardMaterial["onBeforeCompile"]>[0],
      {} as WebGLRenderer,
    );
    expect(shader.uniforms.visualSeed!.value).toBe(42);
    expect(shader.uniforms.visualNoiseScale!.value).toBe(6);
    expect(shader.uniforms.visualColor!.value.w).toBe(0.25);
    effects.dispose();
  });
  it("owns a dissolve target exclusively and rejects transparent materials", () => {
    const effects = new VisualEffects();
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    effects.play({ ...options, effectId: "dissolve" }, mesh);
    expect(() => effects.play({ ...options, runId: "b", effectId: "dissolve" }, mesh)).toThrow();
    effects.dispose();
    mesh.material.transparent = true;
    expect(() => effects.play({ ...options, effectId: "dissolve" }, mesh)).toThrow();
  });
  it("retains dense hand trajectories and fades a ring with the trail", () => {
    const effects = new VisualEffects();
    const target = new Group();
    const hand = effects.begin({ ...options, effectId: "handGlow", durationMs: 350 }, target);
    for (let i = 0; i < 100; i++) hand.updatePose(new Vector3(i / 100, 0, 0), 100 + i);
    effects.evaluate(199);
    const [halo, trail] = target.children[0]!.children as Mesh<BufferGeometry, MeshBasicMaterial>[];
    expect(trail!.geometry.drawRange.count).toBe(99 * 6);
    const opacity = trail!.geometry.getAttribute("color");
    expect(opacity.getW(0)).toBe(0);
    expect(opacity.getW(198)).toBe(1);
    const ring = halo!.geometry.getAttribute("position");
    expect(ring.getX(0)).toBeCloseTo(0.99 + 0.035);
    expect(ring.getY(12)).toBeCloseTo(0.035);
    hand.end(199);
    effects.evaluate(374);
    expect(halo!.visible).toBe(true);
    expect(halo!.material.opacity).toBeCloseTo(0.5);
    expect(trail!.material.opacity).toBeCloseTo(0.5);
    effects.evaluate(549);
    expect(target.children).toHaveLength(0);
  });
  it("ends hand emission and drains its trail on external time", () => {
    const effects = new VisualEffects();
    const target = new Group();
    const done = vi.fn();
    const hand = effects.begin({ ...options, effectId: "handGlow" }, target, done);
    hand.updatePose(new Vector3(0, 0, 0), 100);
    hand.updatePose(new Vector3(1, 0, 0), 200);
    effects.evaluate(200);
    hand.end(200);
    effects.evaluate(1200);
    expect(done).toHaveBeenCalledTimes(1);
    expect(target.children).toHaveLength(0);
  });
});

describe("wave choreography", () => {
  it("multiplies wave opacity without accumulating or changing its path, scale or tip", () => {
    const effects = new VisualEffects();
    const target = new Group();
    effects.play({ ...options, color: [1, 1, 1, 0.8] }, target);
    effects.setWaveOpacity(options.runId, 0.5);
    effects.evaluate(210);
    const group = target.children[0]!;
    const line = group.children[0] as Line<BufferGeometry, LineBasicMaterial>;
    expect(line.material.opacity).toBeCloseTo(0.2);
    effects.evaluate(1100);
    const positions = [...line.geometry.getAttribute("position").array];
    const colors = [...line.geometry.getAttribute("color").array];
    expect(line.material.opacity).toBeCloseTo(0.4);
    for (const opacity of [0.5, 0, 1]) {
      effects.setWaveOpacity(options.runId, opacity);
      effects.evaluate(1100);
      expect(line.material.opacity).toBeCloseTo(0.8 * opacity);
      expect([...line.geometry.getAttribute("position").array]).toEqual(positions);
      expect([...line.geometry.getAttribute("color").array]).toEqual(colors);
      expect(group.scale.toArray()).toEqual([1, 1, 1]);
    }
    effects.dispose();
  });
  it.each([NaN, Infinity, -Infinity, -0.01, 1.01])("rejects invalid wave opacity %s", (opacity) => {
    const effects = new VisualEffects();
    const target = new Group();
    effects.play(options, target);
    effects.setWaveOpacity(options.runId, 0.5);
    expect(() => effects.setWaveOpacity(options.runId, opacity)).toThrow("Invalid wave opacity");
    effects.evaluate(1100);
    const line = target.children[0]!.children[0] as Line<BufferGeometry, LineBasicMaterial>;
    expect(line.material.opacity).toBe(0.5);
    effects.dispose();
  });

  it.each([0.137, 0.5, 1])(
    "softens the advancing tip without dimming the body at progress %s",
    (progress) => {
      const effects = new VisualEffects();
      const target = new Group();
      effects.play(options, target);
      effects.evaluate(options.startedAtRuntimeMs + options.durationMs * progress);
      const wave = target.children[0];
      assert(wave);
      const strand = wave.children[0];
      assert(strand instanceof Line);
      const positions = strand.geometry.getAttribute("position");
      const colors = strand.geometry.getAttribute("color");
      const last = strand.geometry.drawRange.count - 1;
      expect(positions.count).toBeGreaterThanOrEqual(256);
      expect(colors.itemSize).toBe(4);
      expect(positions.getX(last)).toBeCloseTo(-4 + 8 * progress);
      expect(colors.getW(0)).toBe(1);
      expect(colors.getW(last)).toBe(0);
      expect(colors.getW(last - 1)).toBeGreaterThan(0);
      expect(colors.getW(last - 1)).toBeLessThan(1);
      for (let i = 1; i <= last; i++) {
        expect(positions.getX(i) - positions.getX(i - 1)).toBeLessThanOrEqual(8 / 255 + 0.000001);
        expect(colors.getW(i)).toBeLessThanOrEqual(colors.getW(i - 1));
      }
      effects.dispose();
    },
  );
  it("reconstructs the same tip and path when external playback time is revisited", () => {
    const effects = new VisualEffects();
    const target = new Group();
    effects.play(options, target);
    effects.evaluate(600);
    const wave = target.children[0];
    assert(wave);
    const strand = wave.children[0];
    assert(strand instanceof Line);
    const positions = Array.from(strand.geometry.getAttribute("position").array);
    const colors = Array.from(strand.geometry.getAttribute("color").array);
    const range = { ...strand.geometry.drawRange };
    effects.evaluate(1100);
    effects.evaluate(600);
    expect(Array.from(strand.geometry.getAttribute("position").array)).toEqual(positions);
    expect(Array.from(strand.geometry.getAttribute("color").array)).toEqual(colors);
    expect(strand.geometry.drawRange).toEqual(range);
    effects.dispose();
  });
  it("inherits an anchor scale animation while retaining the sampled path", () => {
    const effects = new VisualEffects();
    const target = new Group();
    effects.play(options, target);
    effects.evaluate(1100);
    const wave = target.children[0];
    assert(wave);
    const strand = wave.children[0];
    assert(strand instanceof Line);
    const positions = strand.geometry.getAttribute("position");
    const first = new Vector3().fromBufferAttribute(positions, 0);
    const last = new Vector3().fromBufferAttribute(positions, positions.count - 1);
    target.updateMatrixWorld(true);
    const full = strand.localToWorld(first.clone()).distanceTo(strand.localToWorld(last.clone()));
    const sampled = Array.from(positions.array);
    target.scale.setScalar(0.25);
    effects.evaluate(2100);
    target.updateMatrixWorld(true);
    const shrinking = strand
      .localToWorld(first.clone())
      .distanceTo(strand.localToWorld(last.clone()));
    expect(shrinking).toBeCloseTo(full * 0.25);
    expect(Array.from(positions.array)).toEqual(sampled);
    effects.dispose();
  });
  it("keeps the vertical bend gentle across the full width", () => {
    const effects = new VisualEffects();
    const target = new Group();
    effects.play(options, target);
    effects.evaluate(1100);
    const first = (target.children[0]!.children[0] as Line).geometry.getAttribute("position");
    const heights = Array.from({ length: first.count }, (_, i) => first.getY(i));
    const range = Math.max(...heights) - Math.min(...heights);
    expect(range).toBeLessThanOrEqual(1.20001);
    expect(range).toBeGreaterThan(1);
    effects.dispose();
  });
  it.each([0.5, 2])("holds the fully drawn wave until cancellation at speed %s", (speed) => {
    const effects = new VisualEffects();
    const target = new Group();
    const done = vi.fn();
    const handle = effects.play({ ...options, speed }, target, done);
    effects.evaluate(options.startedAtRuntimeMs - 1);
    expect(target.children[0]?.visible).toBe(false);
    const end = options.startedAtRuntimeMs + options.durationMs / speed;
    effects.evaluate(end);
    expect(target.children).toHaveLength(1);
    const wave = target.children[0]!;
    expect(wave.visible).toBe(true);
    const lines = wave.children as Line<BufferGeometry, LineBasicMaterial>[];
    const positions = lines.map((item) => Array.from(item.geometry.getAttribute("position").array));
    const ranges = lines.map((item) => ({ ...item.geometry.drawRange }));
    for (const item of lines) {
      expect(item.material.opacity).toBe(options.color[3]);
      expect(item.geometry.drawRange.count).toBe(item.geometry.getAttribute("position").count);
    }
    effects.evaluate(end + 10000);
    expect(target.children[0]).toBe(wave);
    expect(lines.map((item) => Array.from(item.geometry.getAttribute("position").array))).toEqual(
      positions,
    );
    expect(lines.map((item) => item.geometry.drawRange)).toEqual(ranges);
    expect(lines.map((item) => item.material.opacity)).toEqual(lines.map(() => options.color[3]));
    expect(effects.play({ ...options, speed }, target)).toBe(handle);
    expect(done).not.toHaveBeenCalled();
    const released = lines.map((item) => ({
      geometry: vi.spyOn(item.geometry, "dispose"),
      material: vi.spyOn(item.material, "dispose"),
    }));
    handle.cancel();
    handle.cancel();
    expect(target.children).toHaveLength(0);
    expect(done).not.toHaveBeenCalled();
    for (const item of released) {
      expect(item.geometry).toHaveBeenCalledTimes(1);
      expect(item.material).toHaveBeenCalledTimes(1);
    }
  });
  it("disposes held waves and frees their execution capacity", () => {
    const effects = new VisualEffects();
    const target = new Group();
    for (let i = 0; i < 32; i++) effects.play({ ...options, runId: `held-${i}` }, target);
    effects.evaluate(10000);
    expect(target.children).toHaveLength(32);
    expect(() => effects.play(options, target)).toThrow("Effect capacity exceeded");
    effects.dispose();
    expect(target.children).toHaveLength(0);
    effects.play(options, target);
    expect(target.children).toHaveLength(1);
    effects.dispose();
  });
  it("reveals parallel planar strands from left to right without moving drawn sections", () => {
    const effects = new VisualEffects();
    const target = new Group();
    effects.play(options, target);
    effects.evaluate(600);
    const lines = target.children[0]!.children as Line[];
    const first = lines[0]!.geometry.getAttribute("position");
    const count = lines[0]!.geometry.drawRange.count;
    expect(first.getX(0)).toBe(-4);
    expect(first.getX(count - 1)).toBeCloseTo(0);
    const drawn = [first.getX(10), first.getY(10), first.getZ(10)];
    effects.evaluate(1100);
    expect([first.getX(10), first.getY(10), first.getZ(10)]).toEqual(drawn);
    expect(first.getX(first.count - 1)).toBe(4);
    expect(first.getY(Math.floor(first.count / 2))).toBeLessThan(first.getY(0));
    expect(first.getY(Math.floor(first.count / 2))).toBeLessThan(first.getY(first.count - 1));
    lines.forEach((item, lane) => {
      const points = item.geometry.getAttribute("position");
      for (let i = 0; i < points.count; i++) {
        expect(points.getZ(i)).toBe(0);
        expect(points.getX(i)).toBe(first.getX(i));
        expect(first.getY(i) - points.getY(i)).toBeCloseTo(lane * 0.12);
        if (i > 0) expect(points.getX(i)).toBeGreaterThan(points.getX(i - 1));
      }
    });
    effects.dispose();
  });
  it("places, starts and cancels two waves independently", () => {
    const effects = new VisualEffects();
    const left = new Group();
    const right = new Group();
    left.position.set(-5, 2, 1);
    right.position.set(5, 3, 2);
    right.rotation.y = Math.PI;
    const a = effects.play(options, left);
    effects.play({ ...options, runId: "b", size: 2, startedAtRuntimeMs: 2100 }, right);
    effects.evaluate(1100);
    expect(left.children[0]?.visible).toBe(true);
    expect(right.children[0]?.visible).toBe(false);
    effects.evaluate(3100);
    left.updateMatrixWorld(true);
    right.updateMatrixWorld(true);
    const lineA = left.children[0]!.children[0] as Line;
    const lineB = right.children[0]!.children[0] as Line;
    const startA = lineA.localToWorld(
      new Vector3().fromBufferAttribute(lineA.geometry.getAttribute("position"), 0),
    );
    const startB = lineB.localToWorld(
      new Vector3().fromBufferAttribute(lineB.geometry.getAttribute("position"), 0),
    );
    expect(startA.x).toBeCloseTo(-9);
    expect(startA.z).toBeCloseTo(1);
    expect(startB.x).toBeCloseTo(13);
    expect(startB.z).toBeCloseTo(2);
    a.cancel();
    expect(left.children).toHaveLength(0);
    expect(right.children).toHaveLength(1);
    effects.evaluate(10000);
    expect(right.children[0]?.visible).toBe(true);
    effects.dispose();
  });
  it("colors each strand along its length and applies tint and a shared seeded phase", () => {
    const effects = new VisualEffects();
    const target = new Group();
    effects.play({ ...options, color: [1, 1, 1, 1] }, target);
    effects.evaluate(1100);
    const lines = target.children[0]!.children as Line[];
    const colors = lines[0]!.geometry.getAttribute("color");
    const blue = new Color("#7187f5");
    const coral = new Color("#df7b80");
    expect(colors.getX(0)).toBeCloseTo(blue.r);
    expect(colors.getY(0)).toBeCloseTo(blue.g);
    expect(colors.getZ(0)).toBeCloseTo(blue.b);
    expect(colors.getX(colors.count - 1)).toBeCloseTo(coral.r);
    expect(colors.getY(colors.count - 1)).toBeCloseTo(coral.g);
    expect(colors.getZ(colors.count - 1)).toBeCloseTo(coral.b);
    expect(Array.from(lines[11]!.geometry.getAttribute("color").array)).toEqual(
      Array.from(colors.array),
    );
    const first = Array.from(lines[0]!.geometry.getAttribute("position").array);
    effects.dispose();
    effects.play({ ...options, seed: 3 }, target);
    effects.evaluate(1100);
    const tinted = target.children[0]!.children[0] as Line<BufferGeometry, LineBasicMaterial>;
    const tint = new Color().setRGB(options.color[0], options.color[1], options.color[2], "srgb");
    expect(tinted.material.color.equals(tint)).toBe(true);
    expect(Array.from(tinted.geometry.getAttribute("position").array)).not.toEqual(first);
    effects.dispose();
  });
});
