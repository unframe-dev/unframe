import type { AuthorInstance } from "@unframe/contracts/author-http";
import { useState, useEffect } from "react";
import { Button } from "../ui/button";
export function PropsField({
  id,
  prop,
  disabled,
  changed,
  onChange,
  onSave,
}: {
  id: string;
  prop: AuthorInstance["props"][string];
  disabled: boolean;
  changed: boolean;
  onChange: (value: string | number | boolean) => void;
  onSave: () => void;
}) {
  const [text, setText] = useState(String(prop.value));
  useEffect(() => setText(String(prop.value)), [prop.value]);
  const invalid = prop.type === "number" && (text.trim() === "" || !Number.isFinite(Number(text)));
  return (
    <div className="props-field">
      <label htmlFor={`prop-${id}`}>
        {id}
        {prop.inherited && <small>継承値</small>}
      </label>
      <div className="flex gap-2">
        {prop.type === "boolean" ? (
          <input
            id={`prop-${id}`}
            type="checkbox"
            checked={Boolean(prop.value)}
            disabled={disabled || !prop.editable}
            onChange={(e) => onChange(e.target.checked)}
          />
        ) : prop.editor?.kind === "text" ? (
          <textarea
            id={`prop-${id}`}
            value={String(prop.value)}
            disabled={disabled || !prop.editable}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            id={`prop-${id}`}
            type={prop.type === "number" ? "number" : "text"}
            step="any"
            value={text}
            aria-invalid={invalid}
            disabled={disabled || !prop.editable}
            onChange={(e) => {
              setText(e.target.value);
              const value = prop.type === "number" ? Number(e.target.value) : e.target.value;
              if (e.target.value.trim() !== "" || prop.type !== "number") onChange(value);
            }}
          />
        )}
        <Button disabled={disabled || !prop.editable || !changed || invalid} onClick={onSave}>
          保存
        </Button>
      </div>
      {!prop.editable && <small>Source から変更してください</small>}
    </div>
  );
}
