import { isMixed } from "../lib/mixed.ts";
import { useInspectorOptions } from "../options.ts";
import type { FieldProps } from "../types.ts";
import { FieldRow, inputCls } from "./common.tsx";

export function EntityRefField({ values, onCommit, path }: FieldProps) {
  const { entityIds } = useInspectorOptions();
  const ids = entityIds();
  const mixed = isMixed(values);
  return (
    <FieldRow path={path}>
      <select
        className={inputCls}
        value={mixed ? "" : String(values[0] ?? "")}
        onChange={(e) => onCommit(values.map(() => e.target.value))}
      >
        {mixed && <option value="">—</option>}
        {ids.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}
