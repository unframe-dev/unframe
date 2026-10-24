import {
  type Camera,
  type Texture,
  SRGBColorSpace,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three";
import {
  participantRuntimeViewSchema,
  type DeliveryManifestWire,
  type ParticipantRuntimeView,
} from "@unframe/contracts/presentation";
import type { PngPlan, PngPlane, PngAsset } from "./png-plan";

type TransitionFrames = Record<
  string,
  { fromStateId: string; toStateId: string; progress: number }
>;
type PngMaterial = MeshBasicMaterial | ShaderMaterial;
export interface SurfaceTextureAsset extends PngAsset {
  textureKey?: string;
}
export interface SurfacePlan extends Omit<PngPlan, "assets"> {
  assets: SurfaceTextureAsset[];
}
type LoadedTexture = { texture: Texture; dispose(): void };
function textureKey(asset: SurfaceTextureAsset): string {
  return asset.textureKey ?? asset.checksum;
}

function surfaceCompositeMaterial(
  planes: readonly PngPlane[],
  assetFor: (plane: PngPlane) => { checksum: string; loaded: LoadedTexture },
  bounds: { x: number; y: number; width: number; height: number },
) {
  const number = (value: number) => (Number.isInteger(value) ? `${value}.0` : String(value));
  const vector = (values: readonly number[]) => `vec4(${values.map(number).join(", ")})`;
  const samplers = new Map<string, { name: string; loaded: LoadedTexture }>();
  // Crossfade complete Surface composites; blending overlapping partitions independently changes the colors.
  const commands: string[] = [];
  for (const plane of [...planes].sort((a, b) => a.layer - b.layer)) {
    const asset = assetFor(plane);
    let sampler = samplers.get(asset.checksum);
    if (!sampler) {
      sampler = { name: `image${samplers.size}`, loaded: asset.loaded };
      samplers.set(asset.checksum, sampler);
    }
    const target = plane.transition?.phase === "to" ? "toComposite" : "fromComposite";
    const rect = vector([
      plane.x - plane.width / 2,
      plane.y - plane.height / 2,
      plane.width,
      plane.height,
    ]);
    commands.push(
      `${target} = over(sampleLayer(${sampler.name}, ${rect}, ${vector(plane.uv)}, ${plane.alphaMode === "opaque" ? "1.0" : "0.0"}, ${"isVideoTexture" in asset.loaded.texture && asset.loaded.texture.colorSpace === SRGBColorSpace ? "1.0" : "0.0"}), ${target});`,
    );
  }
  return new ShaderMaterial({
    uniforms: {
      ...Object.fromEntries(
        [...samplers.values()].map((sampler) => [sampler.name, { value: sampler.loaded.texture }]),
      ),
      progress: { value: 0 },
      opacity: { value: planes[0]!.opacity },
    },
    vertexShader: `varying vec2 surfacePoint;
      void main() {
        surfacePoint = ${vector([bounds.x, bounds.y, bounds.width, bounds.height])}.xy + uv * ${vector([bounds.x, bounds.y, bounds.width, bounds.height])}.zw;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `${[...samplers.values()].map((sampler) => `uniform sampler2D ${sampler.name};`).join("\n")}
      uniform float progress; uniform float opacity;
      varying vec2 surfacePoint;
      vec4 sampleLayer(sampler2D image, vec4 rect, vec4 uvBounds, float opaque, float video) {
        vec2 local = (surfacePoint - rect.xy) / rect.zw;
        if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) return vec4(0.0);
        vec4 texel = texture2D(image, mix(uvBounds.xy, uvBounds.zw, local));
        if (video > 0.5) texel = sRGBTransferEOTF(texel);
        texel.a = mix(texel.a, 1.0, opaque);
        return vec4(texel.rgb * texel.a, texel.a);
      }
      vec4 over(vec4 front, vec4 back) { return front + back * (1.0 - front.a); }
      void main() {
        vec4 fromComposite = vec4(0.0);
        vec4 toComposite = vec4(0.0);
        ${commands.join("\n")}
        vec4 mixed = mix(fromComposite, toComposite, progress);
        gl_FragColor = vec4(mixed.a > 0.0 ? mixed.rgb / mixed.a : vec3(0.0), mixed.a * opacity);
        #include <colorspace_fragment>
        gl_FragColor.rgb *= gl_FragColor.a;
      }`,
    opacity: planes[0]!.opacity,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    premultipliedAlpha: true,
  });
}

export async function createSurfacePresentation(options: {
  host: { contentRoot: Group; setPresentationOrigin(value: Matrix4): void };
  delivery: DeliveryManifestWire;
  view: unknown;
  signal?: AbortSignal;
  residentCpuBytes?: number;
  buildPlan(delivery: DeliveryManifestWire, view: ParticipantRuntimeView): SurfacePlan;
  loadTexture(
    asset: SurfaceTextureAsset,
    options: { signal?: AbortSignal },
  ): Promise<LoadedTexture>;
  admitMemory(assets: SurfaceTextureAsset[], residentCpuBytes: number): number;
  assetCpuBytes(asset: SurfaceTextureAsset): number;
  surfaceVisible?(surfaceId: string, view: ParticipantRuntimeView): boolean;
}) {
  const view = participantRuntimeViewSchema.parse(options.view);
  const plan = options.buildPlan(options.delivery, view);
  let retainedCpuBytes = options.admitMemory(plan.assets, options.residentCpuBytes ?? 0);
  const surfaceGroups = new Map<string, Group>();
  const cameraCenter = new Vector3();
  function prepareRender(camera: Camera) {
    if (disposed) return;
    for (const surface of surfaceGroups.values()) {
      surface.updateWorldMatrix(true, false);
      cameraCenter
        .setFromMatrixPosition(surface.matrixWorld)
        .applyMatrix4(camera.matrixWorldInverse);
      // Surface depth takes precedence over partition layers in Three.js's transparent sort.
      surface.renderOrder = cameraCenter.z;
    }
  }
  const root = new Group();
  root.name = "surface-presentation-stage";
  root.matrixAutoUpdate = false;
  const textures = new Map<string, LoadedTexture>();
  let meshes: Mesh<PlaneGeometry, PngMaterial>[] = [];
  let nodeGroups = new Map<string, Group>();
  let meshPlanes = new Map<Mesh<PlaneGeometry, PngMaterial>, PngPlane>();
  let appliedView = view;
  const loadedAssets = new Map(plan.assets.map((asset) => [textureKey(asset), asset]));
  let disposed = false;
  let groupEntry = { id: view.progression.currentGroupId, epoch: view.progression.groupEntryEpoch };
  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (const asset of textures.values()) asset.dispose();
  }
  function checkAbort() {
    if (options.signal?.aborted) throw new Error("PNG presentation cancelled");
  }
  function commitPlan(nextPlan: SurfacePlan, nextView: typeof view) {
    const staging = new Group();
    const nextMeshes: typeof meshes = [];
    const nextSurfaces = new Map<string, Group>();
    const nextMeshPlanes = new Map<Mesh<PlaneGeometry, PngMaterial>, PngPlane>();
    const nodes = new Map<string, Group>();
    const assetsById = new Map(nextPlan.assets.map((asset) => [asset.assetId, asset]));
    try {
      for (const node of nextPlan.nodes) {
        const group = new Group();
        group.name = node.id;
        group.matrixAutoUpdate = false;
        group.matrix.compose(
          new Vector3(...node.transform.position),
          new Quaternion(...node.transform.rotation),
          new Vector3(...node.transform.scale),
        );
        (node.parentId === null ? staging : nodes.get(node.parentId)!).add(group);
        nodes.set(node.id, group);
      }
      const timelineActive = nextView.activeRuns.some((run) => run.kind === "timeline");
      const partitions = new Map<string, PngPlane[]>();
      for (const plane of nextPlan.planes) {
        const composite = !!plane.transition || timelineActive || plane.opacity < 1;
        const key = composite ? `surface:${plane.surfaceId}` : `partition:${plane.id}`;
        const values = partitions.get(key) ?? [];
        values.push(plane);
        partitions.set(key, values);
      }
      for (const planes of partitions.values()) {
        const plane = planes[0]!;
        const composite = !!plane.transition || timelineActive || plane.opacity < 1;
        const minX = Math.min(...planes.map((value) => value.x - value.width / 2));
        const maxX = Math.max(...planes.map((value) => value.x + value.width / 2));
        const minY = Math.min(...planes.map((value) => value.y - value.height / 2));
        const maxY = Math.max(...planes.map((value) => value.y + value.height / 2));
        const geometry = new PlaneGeometry(maxX - minX, maxY - minY);
        if (!composite) {
          const uv = geometry.getAttribute("uv");
          const [u0, v0, u1, v1] = plane.uv;
          uv.setXY(0, u0, v1);
          uv.setXY(1, u1, v1);
          uv.setXY(2, u0, v0);
          uv.setXY(3, u1, v0);
        }
        const transparent = plane.alphaMode === "straight" || plane.opacity < 1;
        const material = composite
          ? surfaceCompositeMaterial(
              planes,
              (value) => {
                const checksum = textureKey(assetsById.get(value.assetId)!);
                return { checksum, loaded: textures.get(checksum)! };
              },
              { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
            )
          : new MeshBasicMaterial({
              map: textures.get(textureKey(assetsById.get(plane.assetId)!))!.texture,
              transparent,
              opacity: plane.opacity,
              depthWrite: !transparent,
              toneMapped: false,
              premultipliedAlpha: false,
            });
        const mesh = new Mesh(geometry, material);
        nextMeshes.push(mesh);
        nextMeshPlanes.set(mesh, plane);
        mesh.name = plane.id;
        mesh.visible = options.surfaceVisible?.(plane.surfaceId, nextView) !== false;
        mesh.position.set(
          (minX + maxX) / 2,
          (minY + maxY) / 2,
          composite ? 0 : plane.layer * 0.0001,
        );
        mesh.renderOrder = composite ? 0 : plane.layer;
        let surface = nextSurfaces.get(plane.nodeId);
        if (!surface) {
          surface = new Group();
          surface.name = `${plane.nodeId}:png-surface`;
          nodes.get(plane.nodeId)!.add(surface);
          nextSurfaces.set(plane.nodeId, surface);
        }
        surface.add(mesh);
      }
    } catch (error) {
      for (const mesh of nextMeshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      throw error;
    }
    const origin = nextView.presentationOrigin.pose;
    options.host.setPresentationOrigin(
      new Matrix4().compose(
        new Vector3(...origin.position),
        new Quaternion(...origin.rotation),
        new Vector3(1, 1, 1),
      ),
    );
    root.clear();
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    meshes = nextMeshes;
    nodeGroups = nodes;
    meshPlanes = nextMeshPlanes;
    appliedView = nextView;
    surfaceGroups.clear();
    for (const [id, surface] of nextSurfaces) surfaceGroups.set(id, surface);
    root.add(...staging.children);
  }
  function applyAnimationFrame(
    nextView: ParticipantRuntimeView,
    transitions: TransitionFrames,
  ): boolean {
    if (disposed) return false;
    if (
      nextView.progression.currentGroupId !== appliedView.progression.currentGroupId ||
      nextView.progression.groupEntryEpoch !== appliedView.progression.groupEntryEpoch
    )
      return false;
    const visibility = new Map<string, { visible: boolean; opacity: number }>();
    const nextPlanNodes = [...nodeGroups.entries()];
    for (const [id, group] of nextPlanNodes) {
      const state = nextView.nodeStates[id];
      if (!state) return false;
      const parent =
        group.parent === root ? { visible: true, opacity: 1 } : visibility.get(group.parent!.name);
      if (!parent) return false;
      visibility.set(id, {
        visible: parent.visible && state.active && state.visible,
        opacity: parent.opacity * state.opacity,
      });
    }
    for (const plane of meshPlanes.values()) {
      const transition = transitions[plane.surfaceId];
      if (plane.transition) {
        const run = appliedView.activeRuns.find(
          (value) => value.kind === "surfaceTransition" && value.surfaceId === plane.surfaceId,
        );
        if (
          !transition ||
          run?.kind !== "surfaceTransition" ||
          transition.fromStateId !== run.fromStateId ||
          transition.toStateId !== run.toStateId ||
          !Number.isFinite(transition.progress) ||
          transition.progress < 0 ||
          transition.progress > 1
        )
          return false;
      } else if (transition) return false;
      if (
        appliedView.surfaceStates[plane.surfaceId]?.stateId !==
        nextView.surfaceStates[plane.surfaceId]?.stateId
      )
        return false;
    }
    for (const [mesh, plane] of meshPlanes) {
      if (
        mesh.material instanceof MeshBasicMaterial &&
        (visibility.get(plane.nodeId)!.opacity < 1 ||
          nextView.activeRuns.some((run) => run.kind === "timeline"))
      )
        return false;
    }
    for (const [mesh, plane] of meshPlanes) {
      const transition = transitions[plane.surfaceId];
      const visible = visibility.get(plane.nodeId)!;
      mesh.visible =
        visible.visible &&
        visible.opacity > 0 &&
        options.surfaceVisible?.(plane.surfaceId, nextView) !== false;
      if (mesh.material instanceof ShaderMaterial) {
        mesh.material.opacity = visible.opacity;
        mesh.material.uniforms.opacity!.value = visible.opacity;
        mesh.material.uniforms.progress!.value = transition?.progress ?? 0;
      } else {
        const transparent = plane.alphaMode === "straight" || visible.opacity < 1;
        if (mesh.material.transparent !== transparent) mesh.material.needsUpdate = true;
        mesh.material.transparent = transparent;
        mesh.material.depthWrite = !transparent;
        mesh.material.opacity = visible.opacity;
      }
    }
    for (const [id, group] of nextPlanNodes) {
      const transform = nextView.nodeStates[id]!.transform;
      group.matrix.compose(
        new Vector3(...transform.position),
        new Quaternion(...transform.rotation),
        new Vector3(...transform.scale),
      );
      group.matrixWorldNeedsUpdate = true;
    }
    const origin = nextView.presentationOrigin.pose;
    options.host.setPresentationOrigin(
      new Matrix4().compose(
        new Vector3(...origin.position),
        new Quaternion(...origin.rotation),
        new Vector3(1, 1, 1),
      ),
    );
    return true;
  }
  function applyView(input: unknown): boolean {
    if (disposed) return false;
    const nextView = participantRuntimeViewSchema.parse(input);
    const nextPlan = options.buildPlan(options.delivery, nextView);
    for (const asset of nextPlan.assets) {
      const loaded = loadedAssets.get(textureKey(asset));
      if (!loaded) return false;
      if (
        loaded.checksum !== asset.checksum ||
        loaded.pixelSize[0] !== asset.pixelSize[0] ||
        loaded.pixelSize[1] !== asset.pixelSize[1] ||
        loaded.encodedSizeBytes !== asset.encodedSizeBytes ||
        loaded.alphaMode !== asset.alphaMode
      )
        throw new Error("PNG presentation: conflicting loaded texture metadata");
    }
    const completedTransition = appliedView.activeRuns.some(
      (run) =>
        run.kind === "surfaceTransition" &&
        !nextView.activeRuns.some(
          (next) =>
            next.kind === "surfaceTransition" &&
            next.runId.assignmentEpoch === run.runId.assignmentEpoch &&
            next.runId.runSequence === run.runId.runSequence,
        ),
    );
    commitPlan(nextPlan, nextView);
    const progression = nextView.progression;
    if (
      completedTransition ||
      groupEntry.id !== progression.currentGroupId ||
      groupEntry.epoch !== progression.groupEntryEpoch
    ) {
      const required = new Set(nextPlan.assets.map(textureKey));
      for (const [checksum, loaded] of textures) {
        if (required.has(checksum)) continue;
        loaded.dispose();
        textures.delete(checksum);
        const asset = loadedAssets.get(checksum)!;
        retainedCpuBytes -= options.assetCpuBytes(asset);
        loadedAssets.delete(checksum);
      }
      groupEntry = { id: progression.currentGroupId, epoch: progression.groupEntryEpoch };
    }
    return true;
  }
  try {
    checkAbort();
    for (const asset of plan.assets) {
      const loaded = await options.loadTexture(
        asset,
        options.signal ? { signal: options.signal } : {},
      );
      textures.set(textureKey(asset), loaded);
      checkAbort();
    }
    commitPlan(plan, view);
    options.host.contentRoot.add(root);
    return {
      root,
      dispose,
      prepareRender,
      get retainedCpuBytes() {
        return retainedCpuBytes;
      },
      applyView,
      applyAnimationFrame,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
