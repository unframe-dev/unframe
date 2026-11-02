import { controlPlaneClient as client } from "@/shared/api/control-plane-client";
import { z } from "zod";

const imageResponse = z.object({ image: z.string().url().nullable() });

export async function updateProfileImage(image: Blob | null) {
  const response = image
    ? await client.users.me.image.$put(
        {},
        { init: { headers: { "content-type": "image/png" }, body: image } },
      )
    : await client.users.me.image.$delete();
  if (!response.ok) throw new Error("アイコンを保存できませんでした。");
  return imageResponse.parse(await response.json()).image;
}
