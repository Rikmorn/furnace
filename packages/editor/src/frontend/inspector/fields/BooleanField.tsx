import { isMixed } from "../lib/mixed.ts";
import type { FieldProps } from "../types.ts";
import { FieldRow } from "./common.tsx";

export function BooleanField({ values, onCommit, path }: FieldProps) {
  const mixed = isMixed(values);
  const checked = !mixed && Boolean(values[0]);
  return (
    <FieldRow path={path}>
      <input
        type="checkbox"
        ref={(el) => {
          if (el) el.indeterminate = mixed;
        }}
        checked={checked}
        onChange={(e) => onCommit(values.map(() => e.target.checked))}
      />
    </FieldRow>
  );
}
