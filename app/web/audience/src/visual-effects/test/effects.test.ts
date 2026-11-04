import { describe, expect, it, vi } from "vite-plus/test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
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
