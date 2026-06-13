import { isMixed } from "../lib/mixed.ts";
import type { FieldProps } from "../types.ts";
import { FieldRow, inputCls } from "./common.tsx";

export function EnumField({ schema, values, onCommit, path }: FieldProps) {
  const options = (schema.enum ?? []).map(String);
  const mixed = isMixed(values);
  return (
    <FieldRow path={path}>
      <select
        className={inputCls}
        value={mixed ? "" : String(values[0] ?? "")}
        onChange={(e) => onCommit(values.map(() => e.target.value))}
      >
        {mixed && <option value="">—</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}
