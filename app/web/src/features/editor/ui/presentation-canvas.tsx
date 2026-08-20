import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls, TransformControls, useGLTF } from "@react-three/drei";
import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { MathUtils, type Group } from "three";
import { createDemoAssetResolver } from "@/features/editor/model/demo-glb";
import type { AssetResolver } from "@/features/editor/model/asset-resolver";
import type { Element, ModelElement, TextElement } from "@/features/editor/model/element";
import type { PresentationDocument } from "@/features/editor/model/presentation-document";
import type { Transform } from "@/features/editor/model/transform";
import type { EditorTool, SnapSettings } from "@/features/editor/model/editor-session";
import { Button } from "@/shared/ui/button";
import { detectWebGLSupport } from "./webgl-support";
import moduleStyles from "./presentation-canvas.module.css";
const styles = {
  error: moduleStyles["error"]!,
  loading: moduleStyles["loading"]!,
  text: moduleStyles["text"]!,
};

export interface PresentationCanvasProps {
  document: PresentationDocument;
  activeSlideId: string;
  selectedElementId: string | null;
  tool: EditorTool;
  showGrid: boolean;
  snap: SnapSettings;
  onSelect: (elementId: string | null) => void;
  onTransform: (elementId: string, transform: Transform) => void;
}

interface BoundaryState {
  failed: boolean;
}

class CanvasErrorBoundary extends Component<PropsWithChildren, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo) {}

  override render() {
    if (this.state.failed) return <WebGLUnavailable />;
    return this.props.children;
  }
}

class ModelErrorBoundary extends Component<
  PropsWithChildren<{ assetName: string; url: string }>,
  BoundaryState
> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo) {}

  private retry = () => {
    useGLTF.clear(this.props.url);
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <Html center>
        <div className={styles.error} role="alert">
          <strong>{this.props.assetName}を読み込めません</strong>
          <span>GLBを確認して再試行してください。</span>
          <Button type="button" variant="outline" size="sm" onClick={this.retry}>
            再試行
          </Button>
        </div>
      </Html>
    );
  }
}

function WebGLUnavailable() {
  return (
    <div
      role="region"
      aria-label="3Dプレゼンテーション"
      className="grid size-full min-h-80 place-items-center bg-[#11151d] p-6"
    >
      <div role="alert" className="max-w-lg rounded-md border border-amber-700 p-4">
        <strong className="block">WebGLを利用できません</strong>
        ブラウザのハードウェアアクセラレーションを有効にして、ページを再読み込みしてください。
      </div>
    </div>
  );
}

function LoadedModel({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  return <primitive object={scene} dispose={null} />;
}

function currentTransform(group: Group): Transform {
  group.quaternion.normalize();
  return {
    position: group.position.toArray(),
    rotation: group.quaternion.toArray(),
    scale: group.scale.toArray(),
  };
}

function transformsEqual(left: Transform, right: Transform): boolean {
  return [...left.position, ...left.rotation, ...left.scale].every(
    (value, index) =>
      Math.abs(value - [...right.position, ...right.rotation, ...right.scale][index]!) < 0.000001,
  );
}

function ModelObject({
  element,
  resolver,
  selected,
  interaction,
  onDraggingChange,
}: {
  element: ModelElement;
  resolver: AssetResolver;
  selected: boolean;
  interaction: PresentationCanvasProps;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const group = useRef<Group>(null!);
  const dragStart = useRef<Transform | null>(null);
  const [dragging, setDragging] = useState(false);
  const url = resolver.resolve(element.assetId);

  const setIsDragging = (value: boolean) => {
    setDragging(value);
    onDraggingChange(value);
  };

  const beginDrag = () => {
    if (!group.current) return;
    dragStart.current = currentTransform(group.current);
    setIsDragging(true);
  };

  const finishDrag = () => {
    if (!group.current) return;
    const transform = currentTransform(group.current);
    setIsDragging(false);
    if (!transformsEqual(transform, element.transform)) {
      interaction.onTransform(element.id, transform);
    }
    dragStart.current = null;
  };

  useEffect(() => {
    if (!dragging) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !group.current || !dragStart.current) return;
      const start = dragStart.current;
      group.current.position.fromArray(start.position);
      group.current.quaternion.fromArray(start.rotation);
      group.current.scale.fromArray(start.scale);
      setIsDragging(false);
      dragStart.current = null;
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [dragging]);

  const object = (
    <group
      ref={group}
      name={element.name}
      position={element.transform.position}
      quaternion={element.transform.rotation}
      scale={element.transform.scale}
      visible={element.visible}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        if (element.locked) return;
        event.stopPropagation();
        interaction.onSelect(element.id);
      }}
    >
      <ModelErrorBoundary assetName={element.name} url={url}>
        <Suspense
          fallback={
            <Html center>
              <div className={styles.loading} role="status">
                GLBを読み込み中…
              </div>
            </Html>
          }
        >
          <LoadedModel url={url} />
        </Suspense>
      </ModelErrorBoundary>
    </group>
  );

  if (!selected || interaction.tool === "select" || element.locked) {
    return object;
  }

  return (
    <>
      {object}
      <TransformControls
        object={group}
        mode={interaction.tool}
        translationSnap={interaction.snap.enabled ? interaction.snap.translation : null}
        rotationSnap={
          interaction.snap.enabled ? MathUtils.degToRad(interaction.snap.rotationDegrees) : null
        }
        scaleSnap={interaction.snap.enabled ? interaction.snap.scale : null}
        onMouseDown={beginDrag}
        onMouseUp={finishDrag}
      />
    </>
  );
}

function TextObject({ element }: { element: TextElement }) {
  return (
    <group
      position={element.transform.position}
      quaternion={element.transform.rotation}
      scale={element.transform.scale}
      visible={element.visible}
    >
      <Html center transform distanceFactor={5}>
        <div className={styles.text}>{element.content}</div>
      </Html>
    </group>
  );
}

function SceneElement({
  element,
  resolver,
  interaction,
  onDraggingChange,
}: {
  element: Element;
  resolver: AssetResolver;
  interaction: PresentationCanvasProps;
  onDraggingChange: (dragging: boolean) => void;
}) {
  if (element.type === "text") return <TextObject element={element} />;
  return (
    <ModelObject
      element={element}
      resolver={resolver}
      selected={interaction.selectedElementId === element.id}
      interaction={interaction}
      onDraggingChange={onDraggingChange}
    />
  );
}

function PresentationScene({
  props,
  resolver,
}: {
  props: PresentationCanvasProps;
  resolver: AssetResolver;
}) {
  const [dragging, setDragging] = useState(false);
  const slide = props.document.slides.find((candidate) => candidate.id === props.activeSlideId);
  return (
    <>
      <color attach="background" args={["#11151d"]} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[4, 6, 3]} intensity={2.4} />
      <directionalLight position={[-3, 2, -4]} intensity={0.8} color="#9ca8ff" />
      {props.showGrid ? (
        <gridHelper args={[12, 24, "#7187f5", "#2b303c"]} position={[0, -0.72, 0]} />
      ) : null}
      {slide?.elements.map((element) => (
        <SceneElement
          key={element.id}
          element={element}
          resolver={resolver}
          interaction={props}
          onDraggingChange={setDragging}
        />
      ))}
      <OrbitControls makeDefault enabled={!dragging} minDistance={2} maxDistance={12} />
    </>
  );
}

export function PresentationCanvas(props: PresentationCanvasProps) {
  const resolver = useMemo(() => createDemoAssetResolver(), []);
  const webGLAvailable = useMemo(() => detectWebGLSupport(), []);

  if (!webGLAvailable) return <WebGLUnavailable />;

  return (
    <div role="region" aria-label="3Dプレゼンテーション" className="relative size-full min-h-80">
      <CanvasErrorBoundary>
        <Canvas
          camera={{ position: [3.2, 2.4, 4.2], fov: 42, near: 0.1, far: 100 }}
          dpr={[1, 2]}
          onPointerMissed={() => props.onSelect(null)}
        >
          <PresentationScene props={props} resolver={resolver} />
        </Canvas>
      </CanvasErrorBoundary>
    </div>
  );
}
