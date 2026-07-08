import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.tsx";
import { isMixed } from "../lib/mixed.ts";
import { useInspectorOptions } from "../options.ts";
import type { FieldProps } from "../types.ts";
import { denseTriggerCls, FieldRow, MIXED } from "./common.tsx";

export function ResourceRefField({ schema, values, onCommit, path }: FieldProps) {
  const table = String(schema.furnace?.table ?? "");
  const { resourceIds } = useInspectorOptions();
  const ids = resourceIds(table);
  const mixed = isMixed(values);
  return (
    <FieldRow path={path}>
      <Select
        value={mixed ? undefined : String(values[0] ?? "")}
        onValueChange={(v) => onCommit(values.map(() => v))}
      >
        <SelectTrigger className={denseTriggerCls}>
          <SelectValue placeholder={MIXED} />
        </SelectTrigger>
        <SelectContent>
          {ids.map((id) => (
            <SelectItem key={id} value={id}>
              {id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldRow>
  );
}
