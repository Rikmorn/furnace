import { isMixed } from "../lib/mixed.ts";
import { useInspectorOptions } from "../options.ts";
import type { FieldProps } from "../types.ts";
import { FieldRow, inputCls } from "./common.tsx";

export function ResourceRefField({ schema, values, onCommit, path }: FieldProps) {
  const table = String(schema.furnace?.table ?? "");
  const { resourceIds } = useInspectorOptions();
  const ids = resourceIds(table);
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
