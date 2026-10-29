import { z } from "zod";
import { safeUIntSchema } from "@unframe/contracts/presentation";

const index = safeUIntSchema;
const attributes = z.record(z.string(), index);
const accessor = z.looseObject({
  bufferView: index.optional(),
  byteOffset: index.optional(),
  componentType: z.union([
    z.literal(5120),
    z.literal(5121),
    z.literal(5122),
    z.literal(5123),
    z.literal(5125),
    z.literal(5126),
  ]),
  type: z.enum(["SCALAR", "VEC2", "VEC3", "VEC4", "MAT2", "MAT3", "MAT4"]),
  count: index,
  sparse: z.looseObject({ count: index }).optional(),
});

export const glbStructureSchema = z.looseObject({
  asset: z.looseObject({ version: z.string() }),
  extensionsUsed: z.array(z.string()).optional(),
  extensionsRequired: z.array(z.string()).optional(),
  buffers: z.array(z.looseObject({ byteLength: index, uri: z.string().optional() })).optional(),
  bufferViews: z
    .array(
      z.looseObject({
        buffer: index.optional(),
        byteOffset: index.optional(),
        byteLength: index,
      }),
    )
    .optional(),
  accessors: z.array(accessor).optional(),
  images: z
    .array(
      z.looseObject({
        uri: z.string().optional(),
        bufferView: index.optional(),
        mimeType: z.string().optional(),
      }),
    )
    .optional(),
  textures: z.array(z.looseObject({ source: index.optional() })).optional(),
  materials: z
    .array(
      z.looseObject({
        alphaMode: z.enum(["OPAQUE", "MASK", "BLEND"]).optional(),
        extensions: z
          .looseObject({
            KHR_materials_unlit: z.looseObject({}).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  meshes: z
    .array(
      z.looseObject({
        primitives: z.array(
          z.looseObject({
            attributes,
            indices: index.optional(),
            material: index.optional(),
            mode: index.optional(),
            targets: z.array(attributes).optional(),
          }),
        ),
      }),
    )
    .optional(),
  nodes: z.array(z.looseObject({})).optional(),
  scenes: z.array(z.looseObject({ nodes: z.array(index).optional() })).optional(),
  scene: index.optional(),
  skins: z.array(z.looseObject({ joints: z.array(index).optional() })).optional(),
  animations: z.array(z.looseObject({})).optional(),
});
