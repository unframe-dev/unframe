import type { ControlPlaneClient } from "@unframe/api-client-typescript";
import { createStarterPresentationDefinition } from "./starter-definition";

type ListPresentationsResponse = Awaited<
  ReturnType<ControlPlaneClient["presentations"]["$get"]>
>;
type ListPresentationsBody = Awaited<ReturnType<ListPresentationsResponse["json"]>>;
export type Presentation = ListPresentationsBody["presentations"][number];

function presentationFixture(
  id: string,
  title: string,
  description: string,
  revision: number,
  createdAt: string,
  updatedAt: string,
): Presentation {
  return {
    id,
    revision,
    definition: createStarterPresentationDefinition(title, description),
    createdAt,
    updatedAt,
  };
}

const mockPresentations: Presentation[] = [
  presentationFixture(
    "mock-spatial-product-review",
    "Spatial product review",
    "MRプロダクトの体験フローと空間設計をレビューするプレゼンテーション。",
    8,
    "2026-08-12T04:30:00.000Z",
    "2026-08-18T08:40:00.000Z",
  ),
  presentationFixture(
    "mock-immersive-exhibition",
    "Immersive exhibition concept",
    "没入型展示のストーリーと演出を検討するコンセプト資料。",
    5,
    "2026-08-10T02:00:00.000Z",
    "2026-08-17T11:20:00.000Z",
  ),
  presentationFixture(
    "mock-unframe-demo-stage",
    "Unframe demo stage",
    "Unframeの基本操作を紹介するデモ用ステージ。",
    2,
    "2026-08-08T06:15:00.000Z",
    "2026-08-15T01:10:00.000Z",
  ),
];

export async function listMockPresentations(): Promise<Presentation[]> {
  return structuredClone(mockPresentations);
}

export async function createMockPresentation(
  title: string,
  description: string,
): Promise<Presentation> {
  const timestamp = new Date().toISOString();
  return {
    id: `mock-${crypto.randomUUID()}`,
    revision: 1,
    definition: createStarterPresentationDefinition(title, description || undefined),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
