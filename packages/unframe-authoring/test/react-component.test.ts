import { describe, expect, it } from "vitest";
import {
  buildOpaqueComponentManifest,
  defineComponent,
  definePresentation,
  editableText,
  prop,
  validateStaticComponentMetadata,
  resolveReactComponentProps,
  setState,
} from "../src/index.js";

const hero = {
  id: "hero",
  props: { title: editableText({ required: true }) },
  semantics: {
    nodes: {
      title: { role: "heading", level: 1, parentId: null, order: 0, text: prop("title") },
    },
    rootNodeIds: ["title"],
  },
  surface: { logicalSize: [960, 540] },
  version: 1,
} as const;

describe("React Component static metadata", () => {
  it("lowers finite states and public operations into the canonical opaque manifest", () => {
    const metadata = validateStaticComponentMetadata({
      ...hero,
      actions: { reveal: { effects: [setState("revealed")], inputs: {}, preconditions: [] } },
      initialState: "hidden",
      interactions: { reveal: { event: "quiz.reveal", hitPriority: 0, kind: "click" } },
      outputs: {
        revealRequested: {
          payload: {},
          producer: { interactionId: "reveal", kind: "surfaceInteraction" },
        },
      },
      semantics: {
        nodes: {
          title: hero.semantics.nodes.title,
          button: {
            role: "button",
            parentId: null,
            order: 1,
            text: "Reveal",
            interactionId: "reveal",
          },
        },
        rootNodeIds: ["title", "button"],
      },
      states: {
        hidden: {
          enabledInteractionIds: ["reveal"],
          semanticOverrides: [{ id: "hide-title", targetId: "title", included: false }],
        },
        revealed: { enabledInteractionIds: [], semanticOverrides: [] },
      },
    });
    const manifest = buildOpaqueComponentManifest(metadata, "renderer/reveal.js");
    expect(manifest.states).toEqual({
      hidden: { initial: true, kind: "state" },
      revealed: { kind: "state" },
    });
    expect(manifest.actions.reveal?.effects).toEqual([
      { kind: "setSurfaceState", stateId: "revealed", surfaceId: "surface" },
    ]);
    expect(manifest.outputs.revealRequested?.producer).toEqual({
      interactionId: "reveal",
      kind: "surfaceInteraction",
    });
    expect(manifest.semantics.surfaces[0]).toMatchObject({
      initialStateId: "hidden",
      interactions: { reveal: { id: "reveal", kind: "click" } },
      states: {
        hidden: {
          id: "hidden",
          semanticOverrides: [{ included: false, kind: "semantic-override", targetId: "title" }],
        },
      },
    });
  });
  it("rejects dangling State, Interaction and semantic override references", () => {
    const base = {
      ...hero,
      actions: { reveal: { effects: [setState("hidden")], inputs: {}, preconditions: [] } },
      initialState: "hidden",
      interactions: { reveal: { event: "quiz.reveal", hitPriority: 0, kind: "click" } },
      outputs: {
        revealRequested: {
          payload: {},
          producer: { interactionId: "reveal", kind: "surfaceInteraction" },
        },
      },
      states: { hidden: { enabledInteractionIds: ["reveal"], semanticOverrides: [] } },
    } as const;
    expect(() => validateStaticComponentMetadata({ ...base, initialState: "missing" })).toThrow();
    expect(() =>
      validateStaticComponentMetadata({
        ...base,
        states: { hidden: { enabledInteractionIds: ["missing"], semanticOverrides: [] } },
      }),
    ).toThrow();
    expect(() =>
      validateStaticComponentMetadata({
        ...base,
        states: {
          hidden: {
            enabledInteractionIds: [],
            semanticOverrides: [{ id: "bad", included: false, targetId: "missing" }],
          },
        },
      }),
    ).toThrow();
    expect(() =>
      validateStaticComponentMetadata({
        ...base,
        actions: { reveal: { effects: [setState("missing")], inputs: {}, preconditions: [] } },
      }),
    ).toThrow();
    expect(() =>
      validateStaticComponentMetadata({
        ...base,
        outputs: {
          revealRequested: {
            payload: {},
            producer: { interactionId: "missing", kind: "surfaceInteraction" },
          },
        },
      }),
    ).toThrow();
  });
  it("validates the render-free descriptor and builds an opaque manifest", () => {
    const metadata = validateStaticComponentMetadata(hero);
    const manifest = buildOpaqueComponentManifest(metadata, "renderer/hero.js");
    expect(manifest.props.title).toEqual({ kind: "string", required: true });
    expect(manifest.semantics.surfaces[0]?.baseSemanticTree.nodes.title).toMatchObject({
      text: { expectedType: "string", kind: "prop-ref", propId: "title" },
    });
    expect(manifest.renderers["baked-web"]?.bindingKeys).toEqual(["surface", "node:title"]);
  });

  it("keeps the author render outside the static descriptor", () => {
    const render = () => "rendered";
    const component = defineComponent({ ...hero, render });
    expect(component.render).toBe(render);
    expect(() => validateStaticComponentMetadata(component)).toThrow();
  });

  it("rejects invalid references, extra fields, and getters without executing them", () => {
    expect(() => validateStaticComponentMetadata({ ...hero, extra: true })).toThrow();
    expect(() =>
      validateStaticComponentMetadata({
        ...hero,
        semantics: {
          ...hero.semantics,
          nodes: { title: { ...hero.semantics.nodes.title, text: prop("missing") } },
        },
      }),
    ).toThrow();
    let invoked = false;
    const value = {
      ...hero,
      get id() {
        invoked = true;
        return "hero";
      },
    };
    expect(() => validateStaticComponentMetadata(value)).toThrow();
    expect(invoked).toBe(false);
  });

  it("validates the public component without evaluating render or getters", () => {
    const render = () => {
      throw new Error("render must not run during declaration validation");
    };
    expect(defineComponent({ ...hero, render }).render).toBe(render);
    expect(() => defineComponent({ ...hero, render, surprise: true } as never)).toThrow();
    let invoked = false;
    expect(() =>
      defineComponent({
        ...hero,
        get id() {
          invoked = true;
          return "hero";
        },
        render,
      } as never),
    ).toThrow();
    expect(invoked).toBe(false);
    expect(() =>
      defineComponent({
        ...hero,
        get render() {
          invoked = true;
          return render;
        },
      } as never),
    ).toThrow();
    expect(invoked).toBe(false);
    expect(() =>
      defineComponent({
        ...hero,
        props: { title: { default: "bad", kind: "string", required: true } },
        render,
      } as never),
    ).toThrow();
    expect(() =>
      defineComponent({
        ...hero,
        render,
        semantics: {
          nodes: { title: { role: "paragraph", level: 1, parentId: null, order: 0, text: "Bad" } },
          rootNodeIds: ["title"],
        },
      } as never),
    ).toThrow();
  });

  it("resolves defaults and validates scene placement and props", () => {
    const component = defineComponent({
      ...hero,
      props: {
        subtitle: editableText({ default: "Fallback" }),
        title: editableText({ required: true }),
      },
      render: () => null,
    });
    expect(resolveReactComponentProps(component, { title: "Hello" })).toEqual({
      subtitle: "Fallback",
      title: "Hello",
    });
    const item = {
      audience: { kind: "all" },
      component,
      fit: "contain",
      id: "opening",
      owner: { kind: "presentation" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1.6, 0.9],
      props: { title: "Hello" },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    } as const;
    const presentation = {
      assets: [],
      flow: {
        groups: {
          main: { id: "main", initialStepId: "first", steps: { first: { id: "first", cues: [] } } },
        },
        initialGroupId: "main",
        variables: {},
      },
      id: "sample",
      metadata: { title: "Sample" },
      operations: [],
      scene: [item],
      stage: {
        coordinateSystem: { forwardAxis: "-Z", handedness: "right", unit: "meter", upAxis: "+Y" },
        size: [6, 3, 6],
      },
    } as const;
    expect(definePresentation(presentation)).toBe(presentation);
    const scene = new Proxy([item], {
      get() {
        throw new Error("scene array property access must not run");
      },
    });
    const proxyPresentation = { ...presentation, scene };
    expect(definePresentation(proxyPresentation)).toBe(proxyPresentation);
    expect(() =>
      definePresentation({ ...presentation, scene: [{ ...item, props: {} }] } as never),
    ).toThrow();
    expect(() =>
      definePresentation({
        ...presentation,
        scene: [{ ...item, props: { extra: true, title: "Hello" } }],
      } as never),
    ).toThrow();
    expect(() =>
      definePresentation({ ...presentation, scene: [{ ...item, props: { title: 42 } }] } as never),
    ).toThrow();
    expect(() =>
      definePresentation({
        ...presentation,
        scene: [{ ...item, physicalSizeMeters: [-1, 1] }],
      } as never),
    ).toThrow();
    expect(() =>
      definePresentation({ ...presentation, scene: [{ ...item, extra: true }] } as never),
    ).toThrow();
    expect(() => definePresentation({ ...presentation, unknown: true } as never)).toThrow();
    expect(() => definePresentation({ ...presentation, flow: {} } as never)).toThrow();
    expect(() => definePresentation({ ...presentation, scene: [item, item] } as never)).toThrow();
    let invoked = false;
    expect(() =>
      definePresentation({
        ...presentation,
        get scene() {
          invoked = true;
          return [item];
        },
      } as never),
    ).toThrow();
    expect(invoked).toBe(false);
    expect(() =>
      definePresentation({
        ...presentation,
        scene: [
          {
            ...item,
            get props() {
              invoked = true;
              return { title: "Hello" };
            },
          },
        ],
      } as never),
    ).toThrow();
    expect(invoked).toBe(false);
  });

  it("separates surface and node binding keys even when a semantic key is surface", () => {
    const metadata = validateStaticComponentMetadata({
      ...hero,
      semantics: {
        nodes: { surface: { order: 0, parentId: null, role: "paragraph", text: "Hello" } },
        rootNodeIds: ["surface"],
      },
    });
    expect(
      buildOpaqueComponentManifest(metadata, "renderer/hero.js").renderers["baked-web"]
        ?.bindingKeys,
    ).toEqual(["surface", "node:surface"]);
  });
});
