// An enum's members, addressable by a string without becoming one.
//
// THE DEFECT THIS EXISTS TO CLOSE: both enum controls speak string values (Radix's Select
// binds a string; a segmented button carries one), and the field used to reach that by
// stringifying the member and committing the string straight back. So a `{ enum: [0, 90] }`
// param round-tripped `90` as `"90"` and every core generator refused it setup-loud — which
// is why stamp `rotation` carries a STRING enum in core to this day: the workaround was put
// in the schema because the field could not be trusted with the member.
//
// The transport value is the member's INDEX, not its label. Parsing the label back
// (`Number(v)`) would work for numbers and silently lie for `1` vs `"1"` — two distinct
// members whose labels are the same string — and there is no third spelling that keeps the
// mapping total.

import type { JsonSchemaNode } from "../types.ts";

/** One enum member: what the control transports, what the user reads, and the value that
 *  is actually committed. */
export type EnumOption = {
  /** The control's string value — the member's INDEX, so it is unique by construction. */
  value: string;
  /** What the user reads. Stringified for display only; never committed. */
  label: string;
  /** The schema member itself, committed by identity. */
  member: unknown;
};

/** A schema node's enum members as addressable options, in declaration order. */
export function enumOptions(schema: JsonSchemaNode): EnumOption[] {
  const members = Array.isArray(schema.enum) ? schema.enum : [];
  return members.map((member, i) => ({
    value: String(i),
    label: String(member),
    member,
  }));
}

/** The member a control's string `value` stands for, or `undefined` when it names none.
 *  Undefined rather than a fallback: committing member 0 for an unrecognised value would
 *  turn a mapping bug into a silent data change. */
export const memberAt = (
  options: readonly EnumOption[],
  value: string,
): unknown => options.find((o) => o.value === value)?.member;

/** The option whose member IS `value` (identity), or `undefined` when the current value is
 *  not one of the members — a stale param the schema has since dropped, which must show
 *  the placeholder rather than a wrong member. */
export const optionFor = (
  options: readonly EnumOption[],
  value: unknown,
): EnumOption | undefined => options.find((o) => o.member === value);
