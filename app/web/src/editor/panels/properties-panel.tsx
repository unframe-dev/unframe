import { zodResolver } from "@hookform/resolvers/zod";
import { Box, Button, Divider, Stack, TextField, Typography } from "@mui/material";
import { Euler, MathUtils, Quaternion } from "three";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { findDocumentElement } from "../../document/model/find-element";
import type { Transform } from "../../document/schema/transform";
import { brandColors } from "../../app/theme/theme";
import { useEditorDocument } from "../document/editor-document-context";
import { useEditorSession } from "../session/editor-session-context";

const TransformFieldsSchema = z.object({
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  positionZ: z.number().finite(),
  rotationX: z.number().finite(),
  rotationY: z.number().finite(),
  rotationZ: z.number().finite(),
  scaleX: z.number().positive(),
  scaleY: z.number().positive(),
  scaleZ: z.number().positive(),
});

type TransformFields = z.infer<typeof TransformFieldsSchema>;

function transformToFields(transform: Transform): TransformFields {
  const euler = new Euler().setFromQuaternion(new Quaternion(...transform.rotation), "XYZ");
  return {
    positionX: transform.position[0],
    positionY: transform.position[1],
    positionZ: transform.position[2],
    rotationX: MathUtils.radToDeg(euler.x),
    rotationY: MathUtils.radToDeg(euler.y),
    rotationZ: MathUtils.radToDeg(euler.z),
    scaleX: transform.scale[0],
    scaleY: transform.scale[1],
    scaleZ: transform.scale[2],
  };
}

function fieldsToTransform(fields: TransformFields): Transform {
  const quaternion = new Quaternion().setFromEuler(
    new Euler(
      MathUtils.degToRad(fields.rotationX),
      MathUtils.degToRad(fields.rotationY),
      MathUtils.degToRad(fields.rotationZ),
      "XYZ",
    ),
  );
  return {
    position: [fields.positionX, fields.positionY, fields.positionZ],
    rotation: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    scale: [fields.scaleX, fields.scaleY, fields.scaleZ],
  };
}

const axes = ["X", "Y", "Z"] as const;
const emptyTransformFields: TransformFields = {
  positionX: 0,
  positionY: 0,
  positionZ: 0,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
};

export function PropertiesPanel() {
  const { history, execute } = useEditorDocument();
  const selectedElementId = useEditorSession((state) => state.selectedElementId);
  const location = findDocumentElement(history.document, selectedElementId);
  const form = useForm<TransformFields, unknown, TransformFields>({
    resolver: zodResolver(TransformFieldsSchema),
    defaultValues: location ? transformToFields(location.element.transform) : emptyTransformFields,
  });

  useEffect(() => {
    if (location) form.reset(transformToFields(location.element.transform));
  }, [form, history.document.revision, selectedElementId]);

  if (!location) {
    return (
      <Box component="aside" aria-label="プロパティ" sx={{ p: 2 }}>
        <Typography component="h2" variant="h2" sx={{ fontSize: 12, letterSpacing: "0.08em" }}>
          プロパティ
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1, fontSize: 13 }}>
          Viewport またはスライド一覧から要素を選択してください。
        </Typography>
      </Box>
    );
  }

  const { element } = location;
  const submit = form.handleSubmit((fields) => {
    execute({
      type: "element.transform",
      elementId: element.id,
      transform: fieldsToTransform(fields),
    });
  });

  return (
    <Box component="aside" aria-label="プロパティ" sx={{ minWidth: 0 }}>
      <Box sx={{ px: 2, py: 1.75 }}>
        <Typography component="h2" variant="h2" sx={{ fontSize: 12, letterSpacing: "0.06em" }}>
          {element.name} のプロパティ
        </Typography>
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>
          {element.type}
        </Typography>
      </Box>
      <Divider />
      <Box
        component="form"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            form.reset(transformToFields(element.transform));
          }
        }}
        sx={{ p: 2 }}
      >
        <Stack spacing={2.25}>
          {(["position", "rotation", "scale"] as const).map((group) => (
            <Box key={group}>
              <Typography
                variant="caption"
                sx={{ color: brandColors.purple, fontWeight: 700, letterSpacing: "0.08em" }}
              >
                {group === "position"
                  ? "位置（m）"
                  : group === "rotation"
                    ? "回転（°）"
                    : "スケール"}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
                {axes.map((axis) => {
                  const name = `${group}${axis}` as keyof TransformFields;
                  return (
                    <TextField
                      key={name}
                      label={axis}
                      type="number"
                      size="small"
                      slotProps={{ htmlInput: { step: group === "rotation" ? 1 : 0.1 } }}
                      error={Boolean(form.formState.errors[name])}
                      {...form.register(name, { valueAsNumber: true })}
                    />
                  );
                })}
              </Stack>
            </Box>
          ))}
          <Button type="submit" variant="contained">
            変形を適用
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
