import { z } from "zod";
const finite = z.number().finite();
const pose = z.strictObject({
  position: z.strictObject({ x: finite, y: finite, z: finite }),
  rotation: z
    .strictObject({ x: finite, y: finite, z: finite, w: finite })
    .refine((q) => Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 0.001),
});
const schema = z.strictObject({
  schemaVersion: z.literal(2),
  boardId: z.string().min(1),
  revision: z.number().int().positive(),
  markers: z
    .array(
      z.strictObject({
        id: z.literal(0),
        sizeMeters: finite.positive().max(2),
        venueFromMarker: pose,
      }),
    )
    .length(1),
  presentationToVenue: pose,
});
export type BoardConfig = z.infer<typeof schema>;
export const detectorImplementations = {
  april: {
    family: "tag36h11",
    port: "arenaxr/apriltag-js-standalone",
    portCommit: "f0fe55676265a1251ad36f18bac9939206a59e19",
    apriltagCommit: "4cdba6a8c6cf4efeb032fa5542da927d4677c035",
    quadDecimate: 1,
    quadSigma: 0,
    threads: 1,
    refineEdges: true,
    cornerOutputStepPx: 0.01,
    cornerRefinement: "upstream-edge-refinement; per-corner status unavailable",
  },
} as const;
export function parseBoardConfig(value: unknown): BoardConfig {
  return schema.parse(value);
}
export async function loadBoardConfig(fetcher: typeof fetch = fetch): Promise<BoardConfig> {
  const response = await fetcher("/poc-config.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`ボード設定を取得できません（HTTP ${response.status}）。`);
  return parseBoardConfig(await response.json());
}
export type TagProfile = {
  id: string;
  revision: 1;
  sizeCm: 22.5 | 36 | 50 | 60 | 70;
  outerSizeMeters: number;
  markerSizeMeters: number;
};
export function selectedTagProfile(search: string): TagProfile {
  const query = new URLSearchParams(search);
  if (query.getAll("size").length > 1)
    throw new Error("タグの設置サイズは一つだけ指定してください。");
  const selected = z.enum(["22.5", "36", "50", "60", "70"]).parse(query.get("size") ?? "22.5");
  const sizeCm = Number(selected) as TagProfile["sizeCm"];
  return {
    id: `audience-large-tag-${sizeCm}`,
    revision: 1,
    sizeCm,
    outerSizeMeters: sizeCm / 100,
    markerSizeMeters: sizeCm / 150,
  };
}
export function configureTagBoard(config: BoardConfig, profile: TagProfile): BoardConfig {
  const marker = config.markers.find((value) => value.id === 0);
  if (!marker) throw new Error("大判単一タグには登録済みID 0が必要です。");
  return parseBoardConfig({
    ...config,
    boardId: profile.id,
    revision: profile.revision,
    markers: [{ ...marker, sizeMeters: profile.markerSizeMeters }],
  });
}
