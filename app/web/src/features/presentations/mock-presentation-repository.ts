import type { ControlPlaneClient } from "@unframe/api-client-typescript";
import placeholderThumbnailUrl from "../../assets/presentations/placeholder-thumbnail.svg?url";
import { createStarterPresentationDefinition } from "./starter-definition";

type ListPresentationsResponse = Awaited<
  ReturnType<ControlPlaneClient["presentations"]["$get"]>
>;
type ListPresentationsBody = Awaited<ReturnType<ListPresentationsResponse["json"]>>;
type PresentationResource = ListPresentationsBody["presentations"][number];
export type Presentation = PresentationResource & { thumbnailUrl: string };

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
    thumbnailUrl: placeholderThumbnailUrl,
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
  presentationFixture(
    "mock-mixed-reality-keynote",
    "Mixed reality keynote",
    "複合現実を使ったキーノートの進行と空間演出を確認する資料。",
    6,
    "2026-08-07T03:25:00.000Z",
    "2026-08-14T09:30:00.000Z",
  ),
  presentationFixture(
    "mock-museum-wayfinding-study",
    "Museum wayfinding study",
    "展示空間における案内表示と来場者の移動経路を検討する資料。",
    4,
    "2026-08-05T07:00:00.000Z",
    "2026-08-13T05:45:00.000Z",
  ),
  presentationFixture(
    "mock-interactive-showroom",
    "Interactive showroom walkthrough",
    "インタラクティブなショールーム体験の導線を確認するプレゼンテーション。",
    3,
    "2026-08-03T01:40:00.000Z",
    "2026-08-12T10:15:00.000Z",
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
    thumbnailUrl: placeholderThumbnailUrl,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
