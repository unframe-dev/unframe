import { zodResolver } from "@hookform/resolvers/zod";
import { Euler, MathUtils, Quaternion } from "three";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { findDocumentElement } from "@/features/editor/model/find-element";
import type { Transform } from "@/features/editor/model/transform";
import { useEditorDocument } from "@/features/editor/model/editor-document-context";
import { useEditorSession } from "@/features/editor/model/editor-session-context";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

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
      <aside aria-label="プロパティ" className="p-4">
        <h2 className="text-xs font-semibold tracking-[.08em]">プロパティ</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Viewport またはスライド一覧から要素を選択してください。
        </p>
      </aside>
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
    <aside aria-label="プロパティ" className="min-w-0">
      <div className="px-4 py-4">
        <h2 className="text-xs font-semibold tracking-[.06em]">{element.name} のプロパティ</h2>
        <p className="text-xs text-[var(--muted)]">{element.type}</p>
      </div>
      <div className="border-t" />
      <form
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            form.reset(transformToFields(element.transform));
          }
        }}
        className="p-4"
      >
        <div className="grid gap-5">
          {(["position", "rotation", "scale"] as const).map((group) => (
            <div key={group}>
              <p className="text-xs font-bold tracking-[.08em] text-[#9a80d0]">
                {group === "position"
                  ? "位置（m）"
                  : group === "rotation"
                    ? "回転（°）"
                    : "スケール"}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {axes.map((axis) => {
                  const name = `${group}${axis}` as keyof TransformFields;
                  return (
                    <Label key={name} className="grid gap-1 text-xs text-[var(--muted)]">
                      {axis}
                      <Input
                        key={name}
                        type="number"
                        step={group === "rotation" ? 1 : 0.1}
                        aria-invalid={Boolean(form.formState.errors[name])}
                        className="h-9 rounded-md border bg-white px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
                        {...form.register(name, { valueAsNumber: true })}
                      />
                    </Label>
                  );
                })}
              </div>
            </div>
          ))}
          <Button type="submit">変形を適用</Button>
        </div>
      </form>
    </aside>
  );
}
