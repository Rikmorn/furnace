// THE SERIALIZABLE HALF OF EVERY ACTION — the rows a process with no DOM can hold.
//
// `frontend/lib/actions.ts` declares 39 actions with 12 fields each. FIVE of those fields
// are closures over a live React context (`label`, `enabled`, `checked`, `run`) or over a
// `KeyboardEvent` (`match`), and they are the whole reason the editor's one action table
// cannot leave the browser. The other seven are data. This module is those seven, for all
// 39, with `match` traded for the `KeyBinding` row that `matchBinding` reads.
//
// WHAT IT IS FOR. The daemon is the consumer that does not exist yet: an MCP tool surface
// has to enumerate the editor's verbs, name them, say when each is refused and hand back a
// JSON Schema for the ones that take input — and it runs on Node, where `KeyboardEvent` is
// a type that resolves and a value that does not. A table of rows travels; a table of
// closures does not.
//
// MIGRATION (until T3b2 Task 4): THE ROWS STAND BESIDE THE LITERALS, exactly as
// `shared/action-table.ts` did in this slice's Task 2 and for the same reason —
// `tests/action-registry/`'s gate derives every field here against the live table and
// asserts them equal, which is a proof only while both sides are standing. Every one of
// these seven fields is currently spelled twice, here and in `frontend/lib/actions.ts`.
// Task 4 moves the five closures across and deletes that table; most of the gate goes
// with it, and this duplication ends.
//
// THE LAYER. `src/action-registry/` sits beside `field-host/` under the chrome: it MAY
// value-import `@furnace/core` and `shared/`, and it may import React, the DOM,
// `field-host/` or `frontend/` not at all — `tests/no-chrome-leakage.test.ts` holds the
// three import rules and `tests/action-registry/node-door.test.ts` holds the DOM one by
// importing this module in a bare runtime. The chrome may reach it TYPE-ONLY, so a schema
// value (zod) can never enter the chrome bundle; `tests/frontend-no-engine-leakage.test.ts`
// holds that half.
//
// The one value import: `LATTICE`, because `edit.grab`'s hint STATES the host's nudge step
// and must read it rather than restate it. The number was already on the neutral floor
// (`shared/field-brush.ts`, where the module that computes with it owns it); what this
// slice's Task 2 changed is that the hint stopped hardcoding `0.5` and started reading it —
// one of the six chrome sites that did (editor-architecture §22.4). The descriptor inherits
// the same obligation, which is why this row is a template literal and not a string.
import type { z } from "@furnace/core/registry";
import { LATTICE } from "../shared/field-brush.ts";
import type { KeyBinding } from "./keys.ts";

/** `world`, `edit` and `view` are the burger's SUBMENUS — one each, rendered from this
 *  table (the holistic gate's ruling 3). `tool` and `session` are the keyboard's, and reach
 *  the user through the tool rail, the status bar's keymap line and the shortcuts overlay
 *  rather than through a menu: arming a brush is the rail's job and ending a session is the
 *  viewport's, so filing them in the burger would be a second, worse route to both.
 *
 *  `help` is the odd one and says so here rather than reading as an oversight: it carries a
 *  single action, and the burger renders that action DIRECTLY rather than as a fourth
 *  submenu. Two reasons, both structural. A one-row submenu is a chevron guarding one row.
 *  And that row's select hands focus to the dialog it opens (`BurgerMenu`'s `handingOff`),
 *  which a generic registry row cannot express — so the menu item is hand-written, and its
 *  label, keycap and verb are read off this table through `byId` so there is still exactly
 *  one spelling of each.
 *
 *  What each group is CALLED, and the order a user meets them in, is the CHROME's
 *  (`ACTION_GROUPS` in `frontend/lib/actions.ts`) — three surfaces name the same six sets
 *  and a title is a rendering fact, not a registry one. */
export type ActionGroup =
  | "world"
  | "edit"
  | "view"
  | "tool"
  | "session"
  | "help";

/** When an action's key is allowed to fire.
 *
 *  - `chord` — a ⌘/Ctrl chord. Live everywhere, INCLUDING inside a text input, because
 *    the browser default it replaces (save-page, the input's own undo stack) is worse.
 *  - `typed` — a key someone could be TYPING: every bare letter, plus ⌫, Esc and ⏎.
 *    Refused when the focus is in a text input, and nowhere else.
 *
 *  There is deliberately no third class for "refused during a look drag". That refusal
 *  is not a property of being bare — it exists for exactly one reason, a keycap that is
 *  ALSO a fly key, and it is declared per action ({@link ActionDescriptor.flyLetter}). A
 *  blanket class would take `R` and `F` down with it for no collision at all: turning a
 *  ghost while orbiting round it is a normal gesture, and `readFlyMove` reads only
 *  w/a/s/d/q/e. */
export type ActionGate = "chord" | "typed";

/** One action, minus everything that needs a live browser.
 *
 *  Absent means absent, uniformly: no `keys` is a menu-only verb the keyboard cannot
 *  reach, no `hint` is a verb whose label says the whole of it, no `gate` is the same
 *  verb read from the other side. `keys` and `gate` are declared together or not at all
 *  (asserted). */
export type ActionDescriptor = {
  /** Stable id, `group.verb`. Unique across the table (asserted).
   *
   *  `string` rather than a union of the 39, deliberately for now. The union is one
   *  `as const satisfies` away and buys a real thing — `shared/action-table.ts`'s
   *  `ToolActionId` is seven hand-written literals that resolve against the registry by
   *  THROWING rather than by assignment — but `shared/` sits BELOW this module and cannot
   *  import the union to narrow against. Whoever gains the first consumer that can use it
   *  should add it; nothing today can. */
  readonly id: string;
  readonly group: ActionGroup;
  /** The key that runs it, as data. Absent = menu-only, unreachable from the keyboard.
   *  The keycap a surface prints is DERIVED from this (`keycap()` in `keys.ts`), not
   *  stated beside it. */
  readonly keys?: KeyBinding;
  /** The ONE sentence an action's label has no room for — the CONDITION and the
   *  consequence — wherever a surface has space to say it: the shortcuts overlay's `what`
   *  column, the ⌘K palette's search keywords, the burger's item `title`, the tool rail's
   *  tooltip, the status bar's selection chip. */
  readonly hint?: string;
  /** When the key may fire. Declared together with {@link keys} (asserted). */
  readonly gate?: ActionGate;
  /** This action re-arms what LMB does, so it is refused while a session owns the
   *  interaction — with a hint, because the key looking dead is the failure mode. */
  readonly armsTool?: boolean;
  /** This keycap is ALSO one of the viewport's fly keys (w/a/s/d/q/e — `readFlyMove`), so
   *  the look drag owns it: refused while the right button is down. */
  readonly flyLetter?: boolean;
  /** Absent = a bare verb, which is all 39 of them today. Present = the zod input schema,
   *  built from `@furnace/core/registry`'s `z` re-export and no other zod install (schema
   *  objects cross registry boundaries and mixing instances breaks `instanceof`
   *  introspection). JSON Schema for the wire comes from `toJsonSchema` at the projection
   *  edge and is never hand-authored.
   *
   *  The import above it is TYPE-ONLY today because nothing sets this field yet; the layer
   *  licenses the value import the moment one does. */
  readonly input?: z.ZodObject<z.ZodRawShape>;
  /** How this verb projects onto ONE MCP tool, recorded here as data for T4 rather than
   *  built now.
   *
   *  Six rows carry it, and they are the whole membership: the axis views. The chrome keeps
   *  six literal ids — `view.snapNegZ` has to be greppable, and the six rows are the WCAG
   *  2.5.8 equivalent affordance for `AxisTriad`'s six sub-minimum tips, so deleting them
   *  re-opens a closed finding (editor-architecture §18.5) — while an agent wants one
   *  `view.snap {axis, sign}` tool rather than six nullary ones. Both, stated once: the id
   *  stays literal, and the row says what it collapses to. */
  readonly mcpProjection?: {
    readonly tool: string;
    readonly input: Readonly<Record<string, unknown>>;
  };
};

/** Every action the editor can run, in the order the table declares them — which is the
 *  order the burger's submenus, the shortcuts overlay's sections and the ⌘K palette's
 *  groups all render in, so it is data rather than incident. */
export const ACTION_DESCRIPTORS: readonly ActionDescriptor[] = [
  {
    id: "world.new",
    group: "world",
  },
  {
    id: "world.open",
    group: "world",
  },
  {
    id: "world.save",
    group: "world",
    keys: { kind: "chord", key: "s" },
    hint: "Save the world — an untitled one opens the drawer to be named first",
    gate: "chord",
  },
  {
    id: "world.saveAs",
    group: "world",
    keys: { kind: "chord", key: "s", shift: true },
    hint: "Name a copy — opens the drawer with the name form ready",
    gate: "chord",
  },
  {
    id: "world.bake",
    group: "world",
  },
  {
    id: "world.makeDefault",
    group: "world",
    hint: "point the game at the SAVED copy of this world — Bake if you want the edits in this session to go with it",
  },
  {
    id: "edit.undo",
    group: "edit",
    keys: { kind: "chord", key: "z" },
    hint: "Undo the last field op — the field's op log is the editor's ONE history",
    gate: "chord",
  },
  {
    id: "edit.redo",
    group: "edit",
    keys: { kind: "chord", key: "z", shift: true },
    hint: "Redo",
    gate: "chord",
  },
  {
    id: "edit.duplicate",
    group: "edit",
    keys: { kind: "chord", key: "j" },
    hint: "Duplicate the selected stamp beside itself — a fresh commit from its own recipe",
    gate: "chord",
  },
  {
    id: "edit.delete",
    group: "edit",
    keys: {
      kind: "named",
      keys: ["Backspace", "Delete"],
      // ⇧⌫ is REFUSED, preserving `edit.delete`'s `!e.shiftKey` exactly. The two rows
      // below say "any" and preserve theirs; the source disagrees and T3b2 did not
      // pick a side (see ShiftPolicy + docs/backlog/editor-and-tooling/
      // named-key-bindings-disagree-on-shift.md).
      shiftPolicy: "up",
    },
    hint: "Delete the selected stamp and the ops it committed, behind a confirm (⌘Z puts it back)",
    gate: "typed",
  },
  {
    id: "edit.grab",
    group: "edit",
    keys: { kind: "bare", key: "g" },
    hint: `Grab the selected stamp — the cursor moves its ghost in ${LATTICE} m steps until ⏎ drops it or Esc discards it`,
    gate: "typed",
  },
  {
    id: "edit.clearSelection",
    group: "edit",
    hint: "drop the cell selection — the ops that were masked by it stop being masked",
  },
  {
    id: "edit.reselect",
    group: "edit",
    hint: "restore the selection the last Clear or replace displaced",
  },
  {
    id: "edit.history",
    group: "edit",
    hint: "the field's ONE history as a list — every step, newest first; click a row to step back to it",
  },
  {
    id: "tool.pointer",
    group: "tool",
    keys: { kind: "bare", key: "v" },
    hint: "Arm Select — click a stamp, a prop or a marker to select it; the wheel travels the camera",
    gate: "typed",
    armsTool: true,
  },
  {
    id: "tool.brush",
    group: "tool",
    keys: { kind: "bare", key: "b" },
    hint: "Arm the brush family — press again with ⇧ to cycle Dig → Fill → Paint → Smooth → Segment",
    gate: "typed",
    armsTool: true,
  },
  {
    id: "tool.brushCycle",
    group: "tool",
    keys: { kind: "shifted", key: "b" },
    hint: "Cycle the brush family: Dig → Fill → Paint → Smooth → Segment",
    gate: "typed",
    armsTool: true,
  },
  {
    id: "tool.select",
    group: "tool",
    keys: { kind: "bare", key: "m" },
    hint: "Arm the cell-selection family — press again with ⇧ to cycle Box → Wand → Room",
    gate: "typed",
    armsTool: true,
  },
  {
    id: "tool.selectCycle",
    group: "tool",
    keys: { kind: "shifted", key: "m" },
    hint: "Cycle the cell-selection family: Box → Wand → Room",
    gate: "typed",
    armsTool: true,
  },
  {
    id: "tool.stamp",
    group: "tool",
    keys: { kind: "bare", key: "s" },
    hint: "Open a stamp session for the family's generator — into the current cell selection, or drag a region for it when there is none",
    gate: "typed",
    armsTool: true,
    flyLetter: true,
  },
  {
    id: "tool.stampCycle",
    group: "tool",
    keys: { kind: "shifted", key: "s" },
    hint: "Point the S key at the next generator — it opens nothing by itself",
    gate: "typed",
    armsTool: true,
    flyLetter: true,
  },
  {
    id: "tool.swapEffect",
    group: "tool",
    keys: { kind: "bare", key: "x" },
    hint: "Swap Dig ↔ Fill and STAY there — ⌃ is the same swap while held",
    gate: "typed",
    armsTool: true,
  },
  {
    id: "session.confirm",
    group: "session",
    keys: { kind: "named", keys: ["Enter"], shiftPolicy: "any" },
    hint: "Commit the ready ghost, apply a reconfigure, or drop a grab",
    gate: "typed",
  },
  {
    id: "session.rotate",
    group: "session",
    keys: { kind: "bare", key: "r" },
    hint: "Quarter-turn the live ghost — refused, with a reason, on a generator that has no rotation",
    gate: "typed",
  },
  {
    id: "session.escape",
    group: "session",
    keys: { kind: "named", keys: ["Escape"], shiftPolicy: "any" },
    hint: "Cancel one thing, most recent first: a half-drawn region, then the live session, then the selected stamp, then the cell selection",
    gate: "typed",
  },
  {
    id: "view.commandPalette",
    group: "view",
    keys: { kind: "chord", key: "k" },
    hint: "Every verb in the editor by name — type, arrow, ⏎; the row says why when one is refused",
    gate: "chord",
  },
  {
    id: "view.frame",
    group: "view",
    keys: { kind: "bare", key: "f" },
    hint: "Frame what is selected — the selected stamp, else the cell selection; with neither it says so",
    gate: "typed",
  },
  {
    id: "view.frameWorld",
    group: "view",
    hint: "Fit the camera to the whole world — runs itself after Open unless you have aimed the camera",
  },
  {
    id: "view.snapPosX",
    group: "view",
    mcpProjection: { tool: "view.snap", input: { axis: "x", sign: 1 } },
  },
  {
    id: "view.snapNegX",
    group: "view",
    mcpProjection: { tool: "view.snap", input: { axis: "x", sign: -1 } },
  },
  {
    id: "view.snapPosY",
    group: "view",
    mcpProjection: { tool: "view.snap", input: { axis: "y", sign: 1 } },
  },
  {
    id: "view.snapNegY",
    group: "view",
    mcpProjection: { tool: "view.snap", input: { axis: "y", sign: -1 } },
  },
  {
    id: "view.snapPosZ",
    group: "view",
    mcpProjection: { tool: "view.snap", input: { axis: "z", sign: 1 } },
  },
  {
    id: "view.snapNegZ",
    group: "view",
    mcpProjection: { tool: "view.snap", input: { axis: "z", sign: -1 } },
  },
  {
    id: "view.normals",
    group: "view",
  },
  {
    id: "view.grid",
    group: "view",
  },
  {
    id: "view.togglePalettes",
    group: "view",
    keys: { kind: "chord", key: "\\" },
    hint: "Hide every palette, or restore the exact arrangement",
    gate: "chord",
  },
  {
    id: "view.resetWorkspace",
    group: "view",
  },
  {
    id: "help.shortcuts",
    group: "help",
    keys: { kind: "char", char: "?" },
    hint: "Every binding this build answers to, in one list — including the viewport keys the canvas owns, which no menu can show",
    gate: "typed",
  },
];
