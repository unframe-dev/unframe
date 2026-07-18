import { produce } from "immer";
import { z } from "zod";
import type { Element } from "../../document/schema/element";
import {
  PresentationDocumentSchema,
  type PresentationDocument,
} from "../../document/schema/presentation-document";
import type { Transform } from "../../document/schema/transform";
import { EditorCommandSchema, type EditorCommand, type ElementChanges } from "./editor-command";

export type CommandApplicationErrorCode =
  | "invalid_command"
  | "target_not_found"
  | "duplicate_id"
  | "invalid_index"
  | "invalid_result";

export class CommandApplicationError extends Error {
  constructor(
    readonly code: CommandApplicationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CommandApplicationError";
  }
}

export interface AppliedCommand {
  document: PresentationDocument;
  inverse: EditorCommand;
}

interface ElementLocation {
  slideIndex: number;
  elementIndex: number;
  element: Element;
}

function findElement(
  document: PresentationDocument,
  elementId: string,
): ElementLocation | undefined {
  for (const [slideIndex, slide] of document.slides.entries()) {
    const elementIndex = slide.elements.findIndex((element) => element.id === elementId);
    const element = slide.elements[elementIndex];
    if (elementIndex >= 0 && element) {
      return { slideIndex, elementIndex, element };
    }
  }
  return undefined;
}

function requireSlideIndex(document: PresentationDocument, slideId: string): number {
  const index = document.slides.findIndex((slide) => slide.id === slideId);
  if (index < 0) {
    throw new CommandApplicationError("target_not_found", `Slide ${slideId} does not exist`);
  }
  return index;
}

function requireElement(document: PresentationDocument, elementId: string): ElementLocation {
  const location = findElement(document, elementId);
  if (!location) {
    throw new CommandApplicationError("target_not_found", `Element ${elementId} does not exist`);
  }
  return location;
}

function cloneTransform(transform: Transform): Transform {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}

function createInverseChanges(element: Element, changes: ElementChanges): ElementChanges {
  const inverse: ElementChanges = {};
  if (changes.name !== undefined) inverse.name = element.name;
  if (changes.visible !== undefined) inverse.visible = element.visible;
  if (changes.locked !== undefined) inverse.locked = element.locked;
  if (changes.content !== undefined) {
    if (element.type !== "text") {
      throw new CommandApplicationError("invalid_command", "Only text elements can update content");
    }
    inverse.content = element.content;
  }
  return inverse;
}

function applyElementAdd(
  document: PresentationDocument,
  command: Extract<EditorCommand, { type: "element.add" }>,
): AppliedCommand {
  const slideIndex = requireSlideIndex(document, command.slideId);
  if (findElement(document, command.element.id)) {
    throw new CommandApplicationError(
      "duplicate_id",
      `Element ${command.element.id} already exists`,
    );
  }
  const elements = document.slides[slideIndex]?.elements;
  if (!elements) {
    throw new CommandApplicationError(
      "target_not_found",
      `Slide ${command.slideId} does not exist`,
    );
  }
  const index = command.index ?? elements.length;
  if (index > elements.length) {
    throw new CommandApplicationError(
      "invalid_index",
      `Element index ${index} is outside slide ${command.slideId}`,
    );
  }

  const next = produce(document, (draft) => {
    draft.slides[slideIndex]?.elements.splice(index, 0, command.element);
    draft.revision += 1;
  });
  return {
    document: validateResult(next),
    inverse: {
      type: "element.remove",
      slideId: command.slideId,
      elementId: command.element.id,
    },
  };
}

function applyElementRemove(
  document: PresentationDocument,
  command: Extract<EditorCommand, { type: "element.remove" }>,
): AppliedCommand {
  const slideIndex = requireSlideIndex(document, command.slideId);
  const slide = document.slides[slideIndex];
  const elementIndex = slide?.elements.findIndex((element) => element.id === command.elementId);
  const element =
    elementIndex === undefined || elementIndex < 0 ? undefined : slide?.elements[elementIndex];
  if (elementIndex === undefined || elementIndex < 0 || !element) {
    throw new CommandApplicationError(
      "target_not_found",
      `Element ${command.elementId} does not exist in slide ${command.slideId}`,
    );
  }

  const next = produce(document, (draft) => {
    draft.slides[slideIndex]?.elements.splice(elementIndex, 1);
    draft.revision += 1;
  });
  return {
    document: validateResult(next),
    inverse: {
      type: "element.add",
      slideId: command.slideId,
      element: structuredClone(element),
      index: elementIndex,
    },
  };
}

function applyElementTransform(
  document: PresentationDocument,
  command: Extract<EditorCommand, { type: "element.transform" }>,
): AppliedCommand {
  const location = requireElement(document, command.elementId);
  const next = produce(document, (draft) => {
    const element = draft.slides[location.slideIndex]?.elements[location.elementIndex];
    if (element) element.transform = command.transform;
    draft.revision += 1;
  });
  return {
    document: validateResult(next),
    inverse: {
      type: "element.transform",
      elementId: command.elementId,
      transform: cloneTransform(location.element.transform),
    },
  };
}

function applyElementUpdate(
  document: PresentationDocument,
  command: Extract<EditorCommand, { type: "element.update" }>,
): AppliedCommand {
  const location = requireElement(document, command.elementId);
  const inverseChanges = createInverseChanges(location.element, command.changes);
  const next = produce(document, (draft) => {
    const element = draft.slides[location.slideIndex]?.elements[location.elementIndex];
    if (!element) return;
    const { changes } = command;
    if (changes.name !== undefined) element.name = changes.name;
    if (changes.visible !== undefined) element.visible = changes.visible;
    if (changes.locked !== undefined) element.locked = changes.locked;
    if (changes.content !== undefined && element.type === "text") {
      element.content = changes.content;
    }
    draft.revision += 1;
  });
  return {
    document: validateResult(next),
    inverse: {
      type: "element.update",
      elementId: command.elementId,
      changes: inverseChanges,
    },
  };
}

function applySlideReorder(
  document: PresentationDocument,
  command: Extract<EditorCommand, { type: "slide.reorder" }>,
): AppliedCommand {
  const fromIndex = requireSlideIndex(document, command.slideId);
  if (command.toIndex >= document.slides.length) {
    throw new CommandApplicationError(
      "invalid_index",
      `Slide index ${command.toIndex} is outside the document`,
    );
  }
  const next = produce(document, (draft) => {
    const [slide] = draft.slides.splice(fromIndex, 1);
    if (slide) draft.slides.splice(command.toIndex, 0, slide);
    draft.revision += 1;
  });
  return {
    document: validateResult(next),
    inverse: {
      type: "slide.reorder",
      slideId: command.slideId,
      toIndex: fromIndex,
    },
  };
}

function validateResult(input: unknown): PresentationDocument {
  try {
    return PresentationDocumentSchema.parse(input);
  } catch (error) {
    throw new CommandApplicationError(
      "invalid_result",
      "Command would create an invalid presentation document",
      { cause: error },
    );
  }
}

export function applyCommand(document: PresentationDocument, input: EditorCommand): AppliedCommand {
  let command: EditorCommand;
  try {
    command = EditorCommandSchema.parse(input);
  } catch (error) {
    const message =
      error instanceof z.ZodError ? z.prettifyError(error) : "Command could not be validated";
    throw new CommandApplicationError("invalid_command", message, {
      cause: error,
    });
  }

  switch (command.type) {
    case "element.add":
      return applyElementAdd(document, command);
    case "element.remove":
      return applyElementRemove(document, command);
    case "element.transform":
      return applyElementTransform(document, command);
    case "element.update":
      return applyElementUpdate(document, command);
    case "slide.reorder":
      return applySlideReorder(document, command);
  }
}
