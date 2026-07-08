import { useEffect, useState } from "react";
import { isMixed } from "../lib/mixed.ts";
import type { FieldProps } from "../types.ts";
import { Input } from "../../components/ui/input.tsx";
import { FieldRow, denseInputCls, MIXED } from "./common.tsx";

export function StringField({ values, onCommit, onCancel, path }: FieldProps) {
  const mixed = isMixed(values);
  const initial = mixed ? "" : String((values[0] as string) ?? "");
  const [text, setText] = useState(initial);
  useEffect(() => setText(initial), [initial]);
  return (
    <FieldRow path={path}>
      <Input
        className={denseInputCls}
        placeholder={mixed ? MIXED : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Do NOT call onCommit here — blur fires onBlur which is the sole committer.
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            onCancel();
            setText(initial);
          }
        }}
        onBlur={() => onCommit(values.map(() => text))}
      />
    </FieldRow>
  );
}
