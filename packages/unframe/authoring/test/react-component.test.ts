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
  version: 1,
  props: { title: editableText({ required: true }) },
  surface: { logicalSize: [960, 540] },
  semantics: {
    rootNodeIds: ["title"],
    nodes: {
      title: { role: "heading", level: 1, parentId: null, order: 0, text: prop("title") },
    },
  },
} as const;

describe("React Component static metadata", () => {
  it("lowers finite states and public operations into the canonical opaque manifest", () => {
    const metadata = validateStaticComponentMetadata({
      ...hero,
      semantics: {
        rootNodeIds: ["title", "button"],
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
      },
      interactions: { reveal: { kind: "click", event: "quiz.reveal", hitPriority: 0 } },
      initialState: "hidden",
      states: {
        hidden: {
          semanticOverrides: [{ id: "hide-title", targetId: "title", included: false }],
          enabledInteractionIds: ["reveal"],
        },
        revealed: { semanticOverrides: [], enabledInteractionIds: [] },
      },
      actions: { reveal: { inputs: {}, preconditions: [], effects: [setState("revealed")] } },
      outputs: {
        revealRequested: {
          payload: {},
          producer: { kind: "surfaceInteraction", interactionId: "reveal" },
        },
      },
    });
    const manifest = buildOpaqueComponentManifest(metadata, "renderer/reveal.js");
    expect(manifest.states).toEqual({
      hidden: { kind: "state", initial: true },
      revealed: { kind: "state" },
    });
    expect(manifest.actions.reveal?.effects).toEqual([
      { kind: "setSurfaceState", surfaceId: "surface", stateId: "revealed" },
    ]);
    expect(manifest.outputs.revealRequested?.producer).toEqual({
      kind: "surfaceInteraction",
      interactionId: "reveal",
    });
    expect(manifest.semantics.surfaces[0]).toMatchObject({
      initialStateId: "hidden",
      interactions: { reveal: { id: "reveal", kind: "click" } },
      states: {
        hidden: {
          id: "hidden",
          semanticOverrides: [{ kind: "semantic-override", targetId: "title", included: false }],
        },
      },
    });
  });
  it("rejects dangling State, Interaction and semantic override references", () => {
    const base = {
      ...hero,
      interactions: { reveal: { kind: "click", event: "quiz.reveal", hitPriority: 0 } },
      initialState: "hidden",
      states: { hidden: { semanticOverrides: [], enabledInteractionIds: ["reveal"] } },
      actions: { reveal: { inputs: {}, preconditions: [], effects: [setState("hidden")] } },
      outputs: {
        revealRequested: {
          payload: {},
          producer: { kind: "surfaceInteraction", interactionId: "reveal" },
        },
      },
    } as const;
    expect(() => validateStaticComponentMetadata({ ...base, initialState: "missing" })).toThrow();
    expect(() =>
      validateStaticComponentMetadata({
        ...base,
        states: { hidden: { semanticOverrides: [], enabledInteractionIds: ["missing"] } },
      }),
    ).toThrow();
    expect(() =>
      validateStaticComponentMetadata({
        ...base,
        states: {
          hidden: {
            semanticOverrides: [{ id: "bad", targetId: "missing", included: false }],
            enabledInteractionIds: [],
          },
        },
      }),
    ).toThrow();
    expect(() =>
      validateStaticComponentMetadata({
        ...base,
        actions: { reveal: { inputs: {}, preconditions: [], effects: [setState("missing")] } },
      }),
    ).toThrow();
    expect(() =>
      validateStaticComponentMetadata({
        ...base,
        outputs: {
          revealRequested: {
            payload: {},
            producer: { kind: "surfaceInteraction", interactionId: "missing" },
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
      text: { kind: "prop-ref", propId: "title", expectedType: "string" },
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
        render,
        get id() {
          invoked = true;
          return "hero";
        },
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
        props: { title: { kind: "string", required: true, default: "bad" } },
        render,
      } as never),
    ).toThrow();
    expect(() =>
      defineComponent({
        ...hero,
        semantics: {
          rootNodeIds: ["title"],
          nodes: { title: { role: "paragraph", level: 1, parentId: null, order: 0, text: "Bad" } },
        },
        render,
      } as never),
    ).toThrow();
  });

  it("resolves defaults and validates scene placement and props", () => {
    const component = defineComponent({
      ...hero,
      props: {
        title: editableText({ required: true }),
        subtitle: editableText({ default: "Fallback" }),
      },
      render: () => null,
    });
    expect(resolveReactComponentProps(component, { title: "Hello" })).toEqual({
      title: "Hello",
      subtitle: "Fallback",
    });
    const item = {
      id: "opening",
      component,
      props: { title: "Hello" },
      owner: { kind: "presentation" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1.6, 0.9],
      fit: "contain",
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    } as const;
    const presentation = {
      id: "sample",
      metadata: { title: "Sample" },
      stage: {
        coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
        size: [6, 3, 6],
      },
      scene: [item],
      assets: [],
      flow: {
        initialGroupId: "main",
        groups: {
          main: { id: "main", initialStepId: "first", steps: { first: { id: "first", cues: [] } } },
        },
        variables: {},
      },
      operations: [],
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
        scene: [{ ...item, props: { title: "Hello", extra: true } }],
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
        rootNodeIds: ["surface"],
        nodes: { surface: { role: "paragraph", parentId: null, order: 0, text: "Hello" } },
      },
    });
    expect(
      buildOpaqueComponentManifest(metadata, "renderer/hero.js").renderers["baked-web"]
        ?.bindingKeys,
    ).toEqual(["surface", "node:surface"]);
  });
});
