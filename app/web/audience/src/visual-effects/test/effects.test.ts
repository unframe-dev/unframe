import { describe, expect, it, vi } from "vite-plus/test";
import {
  BoxGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
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
    const target = new Group();
    const done = vi.fn();
    const handle = effects.play(options, target, done);
    expect(effects.play(options, target)).toBe(handle);
    effects.evaluate(50);
    expect(target.children[0]?.visible).toBe(false);
    effects.evaluate(600);
    expect(target.children[0]?.visible).toBe(true);
    effects.evaluate(1100);
    effects.evaluate(1200);
    expect(done).toHaveBeenCalledTimes(1);
    expect(target.children).toHaveLength(0);
  });
  it("deduplicates independent property order and cleans up before completion callbacks", () => {
    const effects = new VisualEffects();
    const target = new Group();
    const handle = effects.play(options, target, () => {
      effects.play({ ...options, startedAtRuntimeMs: 1100 }, target);
    });
    const { effectId, ...rest } = options;
    const reordered = { effectId, ...rest };
    expect(effects.play(reordered, target)).toBe(handle);
    effects.evaluate(1100);
    expect(target.children).toHaveLength(1);
    effects.dispose();
    effects.play(options, target, () => {
      throw new Error("consumer failure");
    });
    expect(() => effects.evaluate(1100)).toThrow("consumer failure");
    expect(target.children).toHaveLength(0);
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
  it("owns a dissolve target exclusively and rejects transparent materials", () => {
    const effects = new VisualEffects();
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    effects.play({ ...options, effectId: "dissolve" }, mesh);
    expect(() => effects.play({ ...options, runId: "b", effectId: "dissolve" }, mesh)).toThrow();
    effects.dispose();
    mesh.material.transparent = true;
    expect(() => effects.play({ ...options, effectId: "dissolve" }, mesh)).toThrow();
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
  it("crosses behind the target and moves both ends while fading", () => {
    const effects = new VisualEffects();
    const target = new Group();
    effects.play({ ...options, color: [1, 1, 1, 1] }, target);
    effects.evaluate(850);
    const lines = target.children[0]!.children as Line[];
    const left = lines[0]!.geometry.getAttribute("position");
    expect(left.getX(left.count - 1)).toBeGreaterThan(1);
    expect(left.getX(0)).toBeLessThan(0);
    for (let i = 0; i < left.count; i++) expect(left.getZ(i)).toBeLessThan(0);
    const material = lines[0]!.material as LineBasicMaterial;
    const held = material.opacity;
    expect(held).toBeGreaterThan(0.9);
    const headX = left.getX(left.count - 1);
    const tailX = left.getX(0);
    effects.evaluate(1000);
    expect(left.getX(left.count - 1)).toBeGreaterThan(headX);
    expect(left.getX(0)).toBeGreaterThan(tailX);
    expect(material.opacity).toBeLessThan(held);
    effects.dispose();
  });
  it("uses the LP palette with tint and seeded strand variation", () => {
    const effects = new VisualEffects();
    const target = new Group();
    effects.play({ ...options, color: [1, 1, 1, 1] }, target);
    effects.evaluate(850);
    const lines = target.children[0]!.children as Line[];
    expect((lines[0]!.material as LineBasicMaterial).color.equals(new Color("#7187f5"))).toBe(true);
    const expected = new Color("#7187f5").lerp(new Color("#9a80d0"), 1 / 11 / 0.48);
    expect((lines[1]!.material as LineBasicMaterial).color.equals(expected)).toBe(true);
    expect((lines[1]!.material as LineBasicMaterial).opacity).toBeCloseTo(1);
    expect((lines[11]!.material as LineBasicMaterial).color.equals(new Color("#df7b80"))).toBe(
      true,
    );
    const first = Array.from(lines[0]!.geometry.getAttribute("position").array);
    effects.dispose();
    effects.play({ ...options, seed: 3 }, target);
    effects.evaluate(850);
    const second = (target.children[0]!.children[0] as Line).geometry.getAttribute("position");
    expect(Array.from(second.array)).not.toEqual(first);
    effects.dispose();
  });
});
