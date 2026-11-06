import {
  Scene,
  Group,
  PerspectiveCamera,
  WebGLRenderer,
  AmbientLight,
  DirectionalLight,
  GridHelper,
} from "three";
import { createPresentationSession } from "/app/web/audience/src/experience/presentation-session.ts";
const data = await (await fetch("/.unframe/audience-example-check/data.json")).json();
const expected = await (await fetch("./expected.json")).json();
if (data.scenarios.length !== expected.length) throw new Error("Unexpected scenario count");
const renderer = new WebGLRenderer({ canvas: document.querySelector("#canvas"), antialias: true });
renderer.setSize(innerWidth, innerHeight * 0.7, false);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
const scene = new Scene();
const root = new Group();
scene.add(root);
scene.add(new AmbientLight(0xffffff, 2));
const light = new DirectionalLight(0xffffff, 2);
light.position.set(0, 5, 5);
scene.add(light);
scene.add(new GridHelper(12, 24, 0x555566, 0x303040));
const camera = new PerspectiveCamera(55, innerWidth / (innerHeight * 0.7), 0.01, 100);
camera.position.set(0, 1.7, 5);
camera.lookAt(0, 1.5, 0);
const assets = new Map(data.assets.map((a) => [a.url, a]));
const session = createPresentationSession({
  canPlay: () => true,
  onPlaybackBlocked(blocked) {
    if (blocked) throw new Error("playback blocked");
  },
  fetcher: async (url, init) => {
    const a = assets.get(String(url));
    if (!a) throw new Error("unmapped asset " + String(url));
    return fetch("/@fs" + a.path, init);
  },
});
session.attachScene(
  {
    contentRoot: root,
    setPresentationOrigin(matrix) {
      root.matrixAutoUpdate = false;
      root.matrix.copy(matrix);
      root.matrixWorldNeedsUpdate = true;
    },
  },
  renderer,
);
let runtime = session.openRuntime(data.delivery);
renderer.setAnimationLoop(() => {
  session.prepareRender(camera);
  renderer.render(scene, camera);
});
const selector = document.querySelector("#scenario");
data.scenarios.forEach((s, i) => selector.add(new Option(s.label, String(i))));
const status = document.querySelector("#status"),
  result = document.querySelector("#result");
const history = [];
async function run(index) {
  const scenario = data.scenarios[index];
  const states = [];
  status.textContent = "検証中: " + scenario.label;
  for (const item of scenario.control) {
    if (item.connectionSnapshot) {
      runtime = session.openRuntime(data.delivery);
    }
    runtime.applyControl(item);
    const immediate = runtime.getSnapshot();
    if (immediate.phase === "resync-required")
      throw new Error(scenario.label + ": unexpected resync " + JSON.stringify(immediate));
    await runtime.waitForIdle();
    session.prepareRender(camera);
    renderer.render(scene, camera);
    const s = runtime.getSnapshot();
    if (s.error || s.phase === "resync-required")
      throw new Error(scenario.label + ": " + JSON.stringify(s));
    states.push({
      phase: s.phase,
      rendering: s.rendering,
      group: s.view?.progression.currentGroupId,
      step: s.view?.progression.currentStepId,
      sequence: s.reliableSequence,
      frozen: s.view?.frozenAnchors?.length ?? 0,
      children: root.children.length,
    });
  }
  const observed = states.map(({ children: _children, ...state }) => state);
  if (JSON.stringify(observed) !== JSON.stringify(expected[index]))
    throw new Error(
      `${scenario.label}: expected ${JSON.stringify(expected[index])}, received ${JSON.stringify(observed)}`,
    );
  const output = { label: scenario.label, states };
  history.push(output);
  selector.value = String(index);
  status.textContent = "成功: " + scenario.label;
  result.textContent = JSON.stringify(output, null, 2);
  return output;
}
document.querySelector("#run").onclick = () =>
  run(Number(selector.value)).catch((e) => {
    status.textContent = "失敗";
    result.textContent = e.stack;
  });
window.audienceExample = {
  data,
  run,
  history,
  session,
  getRuntime: () => runtime,
  async runAll() {
    const results = [];
    for (let i = 0; i < data.scenarios.length; i++) results.push(await run(i));
    return results;
  },
};
status.textContent = "準備完了";
