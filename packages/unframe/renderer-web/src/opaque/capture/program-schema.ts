import * as z from "zod";

export const opaqueRenderProgramSchema = z.strictObject({
  entryId: z.string().min(1),
  moduleHash: z.string().min(1),
  javascript: z.string(),
  stylesheets: z.array(z.string()),
  assets: z.array(
    z.strictObject({
      path: z.string(),
      mediaType: z.string(),
      dataBase64: z.string(),
    }),
  ),
  props: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()])),
  stateKeysById: z.record(z.string(), z.string()).optional(),
  debugSourceMap: z.string().optional(),
  debugSourcePaths: z.array(z.string()).optional(),
  debugLocalSourceFiles: z.record(z.string(), z.string()).optional(),
  entryOrigins: z
    .array(
      z.strictObject({
        startLine: z.number().int(),
        endLine: z.number().int(),
        firstLinePrefix: z.number().int(),
        origin: z.strictObject({
          fileName: z.string(),
          start: z.number().int(),
          end: z.number().int(),
          line: z.number().int(),
          column: z.number().int(),
        }),
      }),
    )
    .optional(),
});

export type OpaqueProgramSnapshot = z.output<typeof opaqueRenderProgramSchema>;
