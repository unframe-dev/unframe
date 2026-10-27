import { AxesHelper, Group, LineLoop } from "three";
import { describe, expect, it, vi } from "vitest";
import { createPresentationGuide } from "./presentation-guide";

describe("createPresentationGuide", () => {
  it("adds a one meter axis and a one meter wide 16:9 outline to the presentation parent", () => {
    const parent = new Group();
    const guide = createPresentationGuide(parent);
    expect(parent.children).toHaveLength(2);
    const axes = parent.children.find((child) => child instanceof AxesHelper) as AxesHelper;
    const frame = parent.children.find((child) => child instanceof LineLoop) as LineLoop;
    expect(axes.name).toBe("diagnostic-presentation-axes");
    axes.geometry.computeBoundingBox();
    expect(axes.geometry.boundingBox?.max.toArray()).toEqual([1, 1, 1]);
    expect(frame.name).toBe("diagnostic-presentation-frame");
    frame.geometry.computeBoundingBox();
    expect(frame.geometry.boundingBox?.min.toArray()).toEqual([-0.5, -0.28125, 0]);
    expect(frame.geometry.boundingBox?.max.toArray()).toEqual([0.5, 0.28125, 0]);
    guide.dispose();
  });

  it("releases every geometry and material and removes only its own children once", () => {
    const parent = new Group();
    const sibling = new Group();
    parent.add(sibling);
    const guide = createPresentationGuide(parent);
    const releases = parent.children.slice(1).flatMap((child) => {
      const line = child as AxesHelper | LineLoop;
      const materials = Array.isArray(line.material) ? line.material : [line.material];
      return [
        vi.spyOn(line.geometry, "dispose"),
        ...materials.map((material) => vi.spyOn(material, "dispose")),
      ];
    });
    guide.dispose();
    guide.dispose();
    expect(parent.children).toEqual([sibling]);
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
  });
});
