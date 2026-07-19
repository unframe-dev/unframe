import type { Element } from "../schema/element";
import type { PresentationDocument } from "../schema/presentation-document";

export interface ElementLocation {
  element: Element;
  slideId: string;
}

export function findDocumentElement(
  document: PresentationDocument,
  elementId: string | null,
): ElementLocation | null {
  if (!elementId) return null;

  for (const slide of document.slides) {
    const element = slide.elements.find((candidate) => candidate.id === elementId);
    if (element) return { element, slideId: slide.id };
  }
  return null;
}
