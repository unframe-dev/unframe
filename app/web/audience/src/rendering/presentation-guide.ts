import { AxesHelper, BufferGeometry, Group, LineBasicMaterial, LineLoop, Vector3 } from "three";

export function createPresentationGuide(parent: Group): { dispose(): void } {
  const axes = new AxesHelper(1);
  axes.name = "diagnostic-presentation-axes";
  const frame = new LineLoop(
    new BufferGeometry().setFromPoints([
      new Vector3(-0.5, -0.28125, 0),
      new Vector3(0.5, -0.28125, 0),
      new Vector3(0.5, 0.28125, 0),
      new Vector3(-0.5, 0.28125, 0),
    ]),
    new LineBasicMaterial({ color: 0xb9e6ff }),
  );
  frame.name = "diagnostic-presentation-frame";
  parent.add(axes, frame);

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const line of [axes, frame]) {
        line.removeFromParent();
        line.geometry.dispose();
        const materials = Array.isArray(line.material) ? line.material : [line.material];
        for (const material of materials) material.dispose();
      }
    },
  };
}
