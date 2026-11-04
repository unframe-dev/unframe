import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import {
  VisualEffects,
  type EffectHandle,
  type EffectOptions,
  type HandGlowHandle,
} from "./effects";

const style = document.createElement("style");
style.textContent =
  "body{margin:0;background:#111523;color:#edf0ff;font:15px system-ui}main{padding:16px;position:absolute;z-index:1;max-width:720px}h1{font-size:20px}label,button{display:inline-flex;margin:5px;gap:8px;align-items:center}button{padding:8px;border:0;border-radius:5px;cursor:pointer}canvas{display:block;width:100vw;height:100vh}#status{color:#bfc8ef}";
document.head.append(style);
const canvas = document.querySelector<HTMLCanvasElement>("#preview")!;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new Scene();
scene.background = new Color("#111523");
const camera = new PerspectiveCamera(45, 1, 0.01, 100);
camera.position.set(0, 0, 13);
camera.lookAt(0, 0, 0);
scene.add(new AmbientLight(0xffffff, 2));
const light = new DirectionalLight(0xffffff, 3);
light.position.set(2, 3, 4);
scene.add(light);
const floor = new Mesh(
  new PlaneGeometry(20, 20),
  new MeshStandardMaterial({ color: "#1c2433", roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1;
scene.add(floor);
const grid = new GridHelper(20, 20, "#617086", "#354358");
grid.position.y = -0.995;
scene.add(grid);
const waveA = new Group();
waveA.position.set(-4.5, 1, 0);
const waveB = new Group();
waveB.position.set(4.5, 1, 0);
waveB.rotation.y = Math.PI;
scene.add(waveA, waveB);
const model = new Mesh(
  new BoxGeometry(0.8, 0.8, 0.8),
  new MeshStandardMaterial({ color: "#a9b7d8" }),
);
scene.add(model);
const effects = new VisualEffects();
const waves = new Map<string, EffectHandle>();
let hand: HandGlowHandle | undefined;
let clock = 0;
let previous = performance.now();
let paused = false;
let serial = 0;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
function options(effectId: EffectOptions["effectId"]): EffectOptions {
  const hex = document.querySelector<HTMLInputElement>("#color")!.value;
  return {
    runId: `preview-${++serial}`,
    effectId,
    size: Number(document.querySelector<HTMLInputElement>("#size")!.value),
    color: [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
      1,
    ],
    speed: Number(document.querySelector<HTMLInputElement>("#speed")!.value),
    waveCycles: Number(document.querySelector<HTMLInputElement>("#waveCycles")!.value),
    durationMs: effectId === "wave" ? 4500 : 1400,
    seed: 42,
    startedAtRuntimeMs: clock,
  };
}
function button(id: string, action: () => void) {
  document.querySelector<HTMLButtonElement>(`#${id}`)!.onclick = () => {
    try {
      action();
    } catch (error) {
      status.textContent = String(error);
    }
  };
}
function toggleWave(id: string, target: Group, label: string) {
  const active = waves.get(id);
  if (active) {
    active.cancel();
    waves.delete(id);
  } else waves.set(id, effects.play(options("wave"), target));
  document.querySelector<HTMLButtonElement>(`#${id}`)!.textContent =
    `${label}を${active ? "表示" : "消す"}`;
  status.textContent = `${label}を${active ? "消しました" : "表示中"}`;
}
button("wave", () => toggleWave("wave", waveA, "波 A"));
button("wave-b", () => toggleWave("wave-b", waveB, "波 B"));
button("dissolve", () => {
  model.visible = true;
  effects.play(options("dissolve"), model, () => {
    model.visible = false;
    status.textContent = "消失完了";
  });
  status.textContent = "消失中";
});
button("hand", () => {
  hand?.cancel();
  hand = effects.begin(options("handGlow"), scene);
  status.textContent = "手元位置をデモ軌道で更新中";
});
button("end", () => {
  hand?.end(clock);
  hand = undefined;
  status.textContent = "残光の終了待ち";
});
button("reset", () => {
  effects.dispose();
  waves.clear();
  document.querySelector<HTMLButtonElement>("#wave")!.textContent = "波 Aを表示";
  document.querySelector<HTMLButtonElement>("#wave-b")!.textContent = "波 Bを表示";
  hand = undefined;
  model.visible = true;
  status.textContent = "リセットしました";
});
button("pause", () => {
  paused = !paused;
  document.querySelector<HTMLButtonElement>("#pause")!.textContent = paused ? "再開" : "一時停止";
});
renderer.setAnimationLoop(() => {
  const now = performance.now();
  if (!paused) clock += now - previous;
  previous = now;
  if (hand && !paused)
    hand.updatePose(new Vector3(Math.cos(clock / 400), Math.sin(clock / 400) * 0.6, 0.5), clock);
  effects.evaluate(clock);
  const width = innerWidth;
  const height = innerHeight;
  if (
    canvas.width !== Math.floor(width * renderer.getPixelRatio()) ||
    canvas.height !== Math.floor(height * renderer.getPixelRatio())
  ) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
});
window.addEventListener(
  "pagehide",
  () => {
    renderer.setAnimationLoop(null);
    effects.dispose();
    model.geometry.dispose();
    model.material.dispose();
    floor.geometry.dispose();
    floor.material.dispose();
    grid.geometry.dispose();
    for (const material of Array.isArray(grid.material) ? grid.material : [grid.material])
      material.dispose();
    renderer.dispose();
  },
  { once: true },
);
