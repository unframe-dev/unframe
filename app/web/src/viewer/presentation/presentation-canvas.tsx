import { Alert, AlertTitle, Box } from "@mui/material";
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
import { createDemoAssetResolver } from "../../document/fixtures/demo-glb";
import type { AssetResolver } from "../../document/model/asset-resolver";
import type { Element, ModelElement, TextElement } from "../../document/schema/element";
import type { PresentationDocument } from "../../document/schema/presentation-document";
import type { Transform } from "../../document/schema/transform";
import type { EditorTool, SnapSettings } from "../../editor/session/editor-session";
import { detectWebGLSupport } from "./webgl-support";

interface ViewerCanvasProps {
  mode: "viewer";
  document: PresentationDocument;
  activeSlideId: string;
}

interface EditorCanvasProps {
  mode: "editor";
  document: PresentationDocument;
  activeSlideId: string;
  selectedElementId: string | null;
  tool: EditorTool;
  showGrid: boolean;
  snap: SnapSettings;
  onSelect: (elementId: string | null) => void;
  onTransform: (elementId: string, transform: Transform) => void;
}

export type PresentationCanvasProps = ViewerCanvasProps | EditorCanvasProps;

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
        <div className="viewport-error" role="alert">
          <strong>{this.props.assetName}を読み込めません</strong>
          <span>GLBを確認して再試行してください。</span>
          <button type="button" onClick={this.retry}>
            再試行
          </button>
        </div>
      </Html>
    );
  }
}

function WebGLUnavailable() {
  return (
    <Box
      role="region"
      aria-label="3Dプレゼンテーション"
      sx={{
        width: "100%",
        height: "100%",
        minHeight: 320,
        display: "grid",
        placeItems: "center",
        p: 3,
        bgcolor: "#171923",
      }}
    >
      <Alert severity="warning" sx={{ maxWidth: 520 }}>
        <AlertTitle>WebGLを利用できません</AlertTitle>
        ブラウザのハードウェアアクセラレーションを有効にして、ページを再読み込みしてください。
      </Alert>
    </Box>
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
  editor,
  onDraggingChange,
}: {
  element: ModelElement;
  resolver: AssetResolver;
  selected: boolean;
  editor: EditorCanvasProps | null;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const group = useRef<Group>(null);
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
    if (!group.current || !editor) return;
    const transform = currentTransform(group.current);
    setIsDragging(false);
    if (!transformsEqual(transform, element.transform)) {
      editor.onTransform(element.id, transform);
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
        if (!editor || element.locked) return;
        event.stopPropagation();
        editor.onSelect(element.id);
      }}
    >
      <ModelErrorBoundary assetName={element.name} url={url}>
        <Suspense
          fallback={
            <Html center>
              <div className="viewport-loading" role="status">
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

  if (!editor || !selected || editor.tool === "select" || element.locked) {
    return object;
  }

  return (
    <TransformControls
      mode={editor.tool}
      translationSnap={editor.snap.enabled ? editor.snap.translation : null}
      rotationSnap={editor.snap.enabled ? MathUtils.degToRad(editor.snap.rotationDegrees) : null}
      scaleSnap={editor.snap.enabled ? editor.snap.scale : null}
      onMouseDown={beginDrag}
      onMouseUp={finishDrag}
    >
      {object}
    </TransformControls>
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
        <div className="viewport-text">{element.content}</div>
      </Html>
    </group>
  );
}

function SceneElement({
  element,
  resolver,
  editor,
  onDraggingChange,
}: {
  element: Element;
  resolver: AssetResolver;
  editor: EditorCanvasProps | null;
  onDraggingChange: (dragging: boolean) => void;
}) {
  if (element.type === "text") return <TextObject element={element} />;
  return (
    <ModelObject
      element={element}
      resolver={resolver}
      selected={editor?.selectedElementId === element.id}
      editor={editor}
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
  const editor = props.mode === "editor" ? props : null;

  return (
    <>
      <color attach="background" args={["#171923"]} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[4, 6, 3]} intensity={2.4} />
      <directionalLight position={[-3, 2, -4]} intensity={0.8} color="#9ca8ff" />
      {editor?.showGrid ? (
        <gridHelper args={[12, 24, "#5b52f2", "#323645"]} position={[0, -0.72, 0]} />
      ) : null}
      {slide?.elements.map((element) => (
        <SceneElement
          key={element.id}
          element={element}
          resolver={resolver}
          editor={editor}
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
    <Box
      role="region"
      aria-label="3Dプレゼンテーション"
      sx={{ position: "relative", width: "100%", height: "100%", minHeight: 320 }}
    >
      <CanvasErrorBoundary>
        <Canvas
          camera={{ position: [3.2, 2.4, 4.2], fov: 42, near: 0.1, far: 100 }}
          dpr={[1, 2]}
          onPointerMissed={() => {
            if (props.mode === "editor") props.onSelect(null);
          }}
        >
          <PresentationScene props={props} resolver={resolver} />
        </Canvas>
      </CanvasErrorBoundary>
    </Box>
  );
}
