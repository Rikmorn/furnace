import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_CELL_SIZE,
  FIELD_GENERATORS,
  generatorById,
  MAZE_PITCH_CELLS,
  type MaterialTable,
} from "@furnace/core/field";
import { ACTION_DESCRIPTORS } from "../src/action-registry/index.ts";

// The skill names a small number of identifiers on purpose — the vocabulary itself is READ at
// runtime (`session_query {about:"generators"}`, the catalog files) rather than listed, so a
// fifth generator needs no edit here. What this guards is the residue: the ids the skill DOES
// spell, and the handful of NUMBERS it calls unrotting. A renamed action, a retired generator
// or a re-dialled constant rots them silently, because nothing else in the repo reads a
// markdown file for identifiers.
const SKILL = join(
  import.meta.dir,
  "../.claude/skills/sculpting-worlds/SKILL.md",
);
const MCP = join(import.meta.dir, "../src/daemon/mcp.ts");
/** The dungeon's agent profile — the ONE cross-package read in this file, and it is here
 *  because the skill spells this path and quotes a number computed from it. Importing the
 *  dungeon's `AGENT` instead would make the editor's test suite depend on a demo package's
 *  source; reading the JSON the skill names depends only on the artifact the skill cites. */
const AGENT_PROFILE = join(import.meta.dir, "../../dungeon/catalog/agent.json");

const skillText = (): string => readFileSync(SKILL, "utf8");

/** Every `backticked` token in the skill. Most identifiers live here; generator ids are the
 *  exception and are read out of PROSE by {@link generatorPossessives}. */
const backticked = (text: string): string[] =>
  [...text.matchAll(/`([^`\n]+)`/g)].map((m) => {
    // Boundary cast: the pattern's one capturing group has no alternation or `?`, so a
    // successful match always populates it — `RegExpMatchArray`'s indexed type is
    // `string | undefined` only because TS can't see that.
    return m[1] as string;
  });

/** `TOOLS` in `mcp.ts` is deliberately module-private, so this scans the file's own source for
 *  the table's `tool: "..."` rows rather than importing it. Same source-scan TECHNIQUE
 *  `harness-conventions.test.ts` uses in its rule (b) — that file's own reason for scanning is
 *  a process-wide MCP-SDK construction cost, unrelated to this one; only the technique, not
 *  the rationale, carries over. */
const toolNames = (): Set<string> =>
  new Set(
    [...readFileSync(MCP, "utf8").matchAll(/^\s*tool:\s*"([a-z_]+)",$/gm)].map(
      (m) => {
        // Boundary cast: same as `backticked` above — the group is mandatory given a match.
        return m[1] as string;
      },
    ),
  );

test("the door's tool table is still scannable", () => {
  // Guards the guard: a shape change in `mcp.ts` would otherwise turn every assertion below
  // into a vacuous pass over an empty set.
  expect(toolNames().size).toBe(9);
});

/** Action ids share a `namespace.verb` shape with plenty of unrelated backticked tokens the
 *  skill's prose will also use — `mcp.ts`, `index.ts`, `handlers.ts`. A token only counts as
 *  an action-id CANDIDATE if its prefix is one some real action actually uses (derived from
 *  the registry, never hardcoded) and its suffix isn't a source-file extension a filename
 *  would carry instead. */
const actionPrefixes = (): Set<string> =>
  new Set(ACTION_DESCRIPTORS.map((d) => d.id.split(".")[0] ?? ""));

const SOURCE_EXTENSIONS = new Set(["ts", "tsx", "js", "md", "json"]);

/** Tool names are snake_case, a shape the skill's prose will also reach for on unrelated things
 *  — `field_host`, `action_registry`. A token only counts as a tool-name CANDIDATE if its
 *  prefix up to and including the first underscore matches a real tool's prefix (derived from
 *  the scanned table, never hardcoded), or it is exactly `generate` — the one tool name with
 *  no underscore to key a prefix on. RESIDUAL GAP, stated honestly: a typo inside `generate`
 *  itself (e.g. `genereate`) has no prefix to match against, so this filter cannot catch it. */
const toolPrefixes = (names: Set<string>): Set<string> =>
  new Set(
    [...names].filter((n) => n.includes("_")).map((n) => `${n.split("_")[0]}_`),
  );

test("the skill's backtick scan is not reading an empty body", () => {
  // Guards the three guards below, exactly as the tool-table assertion above guards
  // itself: every one of them is a `toEqual([])` over a FILTERED list, so a `backticked()`
  // that matched nothing — an emptied body, a fence style the regex stops seeing — turns
  // all three green while checking no identifier at all. Stated as a floor rather than a
  // count, for `harness-conventions.test.ts`'s reason: a count would be a number to
  // correct on every edit to a markdown file, and nothing reads it. The floor sits far
  // below what the body carries today and far above zero, so prose can be rewritten
  // freely and only an emptied file reddens it.
  expect(backticked(skillText()).length).toBeGreaterThan(5);
});

test("every action id the skill names is a real action", () => {
  const ids = new Set(ACTION_DESCRIPTORS.map((d) => d.id));
  const prefixes = actionPrefixes();
  const named = backticked(skillText()).filter((t) => {
    const m = /^([a-z]+)\.([a-zA-Z]+)$/.exec(t);
    if (!m) return false;
    // Boundary cast: both groups are mandatory given a match (no alternation/`?`).
    const prefix = m[1] as string;
    const suffix = m[2] as string;
    return prefixes.has(prefix) && !SOURCE_EXTENSIONS.has(suffix);
  });
  expect(named.filter((t) => !ids.has(t))).toEqual([]);
});

test("every tool name the skill names is a real tool", () => {
  const tools = toolNames();
  const prefixes = toolPrefixes(tools);
  const named = backticked(skillText()).filter((t) => {
    if (t === "generate") return true;
    if (!/^[a-z]+_[a-z_]+$/.test(t)) return false;
    return prefixes.has(`${t.split("_")[0]}_`);
  });
  expect(named.filter((t) => !tools.has(t))).toEqual([]);
});

/** One registered generator's JSON-Schema document, read for the two facts the skill states
 *  about it: which params it has, and what unit each of them is in. */
type ParamsDocument = {
  properties?: Record<string, { furnace?: { unit?: string } }>;
};

const paramsOf = (id: string): ParamsDocument["properties"] => {
  // Boundary cast: `GeneratorDef.paramSchema` is typed `Record<string, unknown>` because core
  // carries a JSON Schema as plain data, and TS cannot know the document's own shape. The
  // invariant is the JSON Schema specification plus `registry/registry.ts`'s `toJsonSchema`,
  // which hoists the `furnace` bag to each property's node root.
  const doc = FIELD_GENERATORS.find((g) => g.id === id)?.paramSchema as
    | ParamsDocument
    | undefined;
  return doc?.properties;
};

/** Generator ids AS THE SKILL'S PROSE NAMES THEM: an unbackticked possessive immediately
 *  before a backticked param — `A hall's ⁠`width`⁠`, `The scatter generator's ⁠`variants`⁠`.
 *
 *  CANDIDACY COMES FROM THE SKILL'S GRAMMAR, NEVER FROM THE REGISTRY, and that inversion is
 *  the whole repair. The first cut of this file filtered backticked tokens through a literal
 *  `["hall","maze","cave","scatter"]` — the one place it departed from its own "derived from
 *  the registry" rule, and it could not fail twice over: the skill backticks no generator id
 *  at all, so the filter matched `[]`, and even fully populated a filter keyed on today's ids
 *  is BLIND TO A RETIREMENT, because a retired id leaves the registry and the filter at the
 *  same instant. Reading candidates out of the prose leaves the registry free to be the thing
 *  they are CHECKED against, which is the only arrangement in which a retirement reds.
 *
 *  RESIDUAL GAP, stated as the tool-prefix filter above states its own: a generator named in
 *  prose with no possessive and no adjacent param (`the cave generator`, a bare mention) has
 *  no grammar to key on and is not seen here. The bare-backtick half of the case below covers
 *  the other common spelling; between them the two catch what the skill actually writes. */
const generatorPossessives = (text: string): [string, string][] =>
  [...text.matchAll(/([a-z][a-zA-Z-]*)(?: generator)?'s `(\w+)`/g)].map((m) => {
    // Boundary cast: both groups are mandatory given a match (no alternation/`?` on either).
    return [m[1] as string, m[2] as string];
  });

/** Backticked bare words the skill spells that are NOT identifiers. Growing this set is the
 *  deliberate act of saying "I checked this one" — `mcp.test.ts`'s keyword-inventory rule,
 *  pointed at prose. */
const PROSE_WORDS = new Set(["failed"]);

test("the skill names no generator the registry has lost, and invents no param", () => {
  const ids = new Set(FIELD_GENERATORS.map((g) => g.id));
  const everyParam = new Set(
    FIELD_GENERATORS.flatMap((g) => Object.keys(paramsOf(g.id) ?? {})),
  );
  const text = skillText();
  const pairs = generatorPossessives(text);
  const spell = ([g, p]: [string, string]): string => `${g}'s \`${p}\``;
  expect({
    // WHAT WAS READ, ASSERTED BEFORE WHAT WAS FOUND, for the reason `mcp.test.ts`'s node walk
    // states: every list below is a `toEqual([])` over a FILTERED set, so a prose rewrite that
    // stopped using this grammar would turn all three green while checking nothing. A FIXED
    // floor rather than `FIELD_GENERATORS.length`, because the skill's own rule is that a
    // fifth generator needs no edit to the markdown — five pairs sit above it today.
    grammarStillReads: pairs.length >= 4,
    // A RETIREMENT. The skill says `a scatter's \`minSpacing\``; drop `scatter` from
    // `FIELD_GENERATORS` and this is the line that reds.
    unregistered: pairs.filter(([g]) => !ids.has(g)).map(spell),
    // …and a param attached to the WRONG generator, which is the same sentence going stale
    // from the other end (a param moved between defs, or renamed under one of them).
    wrongOwner: pairs
      .filter(([g, p]) => ids.has(g) && !(p in (paramsOf(g) ?? {})))
      .map(spell),
    // AN INVENTION. Every bare alphabetic token the skill backticks has to resolve to a
    // registered generator id, a registered param, or a word listed above as prose. This is
    // the half that catches `\`spiral\`` dropped into a sentence — the sabotage the previous
    // cut of this test sailed through. Bare-alphabetic ON PURPOSE: it is exactly the shape a
    // generator or param id takes, and it excludes the paths, tool names, action ids and
    // expressions the skill also backticks, each of which has its own case in this file.
    unresolved: backticked(text).filter(
      (t) =>
        /^[a-z][a-zA-Z]*$/.test(t) &&
        !ids.has(t) &&
        !everyParam.has(t) &&
        !PROSE_WORDS.has(t),
    ),
  }).toEqual({
    grammarStillReads: true,
    unregistered: [],
    wrongOwner: [],
    unresolved: [],
  });
});

/** Words as `wc -w` counts them: maximal runs of non-whitespace. */
const wordCount = (text: string): number =>
  text.split(/\s+/).filter((w) => w !== "").length;

/** THE SKILL'S DISCOVERY BUDGET, on `mcp.test.ts`'s argument for the tool prose exactly: a
 *  skill body is loaded whole into a context window the moment its description matches, so
 *  every word is paid for on the turn it fires. The review that set this asked whether the
 *  file should split into `SKILL.md` + a reference and answered no — CUT instead, and pin the
 *  result, because an unpinned budget is a budget nobody meets twice.
 *
 *  1,100 was 1.16× head at the cut (948 words, `wc -w` on the file) — 152 words left. The
 *  count is deliberately NOT restated as an equality: prose gets rewritten, and a test that
 *  reds on every rewrite is a number to correct rather than a budget to argue against. */
const WORD_BUDGET = 1100;

test("the skill fits the word budget the review cut it to", () => {
  const words = wordCount(skillText());
  expect(
    { overBudget: words > WORD_BUDGET },
    `${words} words against a ${WORD_BUDGET}-word budget`,
  ).toEqual({ overBudget: false });
});

/** The dungeon's agent profile, as the skill's walkable-width bar reads it. */
type AgentProfile = { capsule: { radius: number }; skin: number };

test("the numbers the skill calls unrotting are the numbers the sources hold", () => {
  const text = skillText();
  // Boundary cast: `JSON.parse` answers `any`; the invariant is the committed catalog file,
  // whose shape `packages/dungeon/src/agent/walkability.ts` also depends on.
  const profile = JSON.parse(
    readFileSync(AGENT_PROFILE, "utf8"),
  ) as AgentProfile;
  // `2·radius + skin`, the skill's own spelling, computed rather than typed — and rounded to
  // the two decimals the prose quotes, because 0.6 + 0.08 is not 0.68 in binary floating
  // point and a test that compared raw would be pinning IEEE 754 rather than the catalog.
  const freeWidth = (2 * profile.capsule.radius + profile.skin).toFixed(2);
  const unitOf = (id: string, param: string): string | undefined =>
    paramsOf(id)?.[param]?.furnace?.unit;
  expect({
    // Each of these is a source value LOOKED FOR IN THE PROSE, not a literal restated beside
    // a literal: re-dial the constant and the sentence stops being found, which is the defect
    // this case exists to catch. A number typed into a tracked doc is what got through the
    // review that ordered these pins.
    fieldCell: text.includes(`**${DEFAULT_CELL_SIZE} m**`),
    walkableWidth: text.includes(`**${freeWidth} m**`),
    // THE MAZE PITCH IS PINNED IN COARSE CELLS, WHICH IS AS FAR AS THE PUBLIC SURFACE REACHES.
    // The skill says a maze cell is 2.5 m; that is `MAZE_PITCH_CELLS` × the 0.5 m coarse cell,
    // and the coarse cell (`CELL` in `core/src/field/generators.ts`) is module-private, as are
    // the door standard's `DOOR_W_CELLS`/`DOOR_H_CELLS` and the `+2` shell in the hall's
    // evaluate. So a change to PASSAGE_CELLS reds here and a change to CELL does not — stated
    // rather than papered over, because a guard trusted for more than it holds is worse than
    // none.
    mazePitchCells: MAZE_PITCH_CELLS,
    // THE PER-GENERATOR UNITS, which is the structural half of the same bullet ("units differ
    // per generator; the schema states them"). Read off `furnace.unit` at each property's node
    // root — the display suffix the editor's form renders and the agent's registry read
    // relays. A def that re-based a param from cells to metres would leave the skill's
    // sentence a lie and nothing else in the repo would notice.
    units: [
      unitOf("hall", "width"),
      unitOf("hall", "height"),
      unitOf("hall", "depth"),
      unitOf("cave", "chamberRadius"),
      unitOf("scatter", "minSpacing"),
    ],
  }).toEqual({
    fieldCell: true,
    walkableWidth: true,
    mazePitchCells: 5,
    units: ["cells", "cells", "cells", "m", "m"],
  });
});

/** THE MODULE-PRIVATE NUMBERS, pinned through the public surface. Three facts the skill
 *  quotes rest on constants inside `core/src/field/generators.ts` (`CELL`, the door's cell
 *  dims, the `+2` shell) — unreachable by import, so the review named them as the guardrail's
 *  blind spot: core's own tests red on any behavioural change, but nothing pointed that red
 *  at this skill. This case DERIVES all three from what a hall actually emits at its defaults
 *  — the same route an agent's `generate` takes — then looks for the skill's spellings,
 *  exactly as the unrotting-numbers case above does.
 *
 *  The algebra gets cell and shell WITHOUT assuming either: the shell fill box satisfies
 *  `(dim + shellCells)·cell = 2·halfExtent` per axis, and the defaults' width ≠ height gives
 *  two independent equations. The door aperture is the union of the dig boxes that reach past
 *  the interior on the doored side. Values are rounded to 3 decimals before use so the case
 *  pins the lattice, not IEEE 754 — the walkable-width pin's own argument. */
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Stamp generators refuse a catalog with no kit class (`kitClassId` throws setup-loud), so
 *  the hall cannot be evaluated against `BUILTIN_TABLE`. This is the minimal kit-carrying
 *  table — the fixture shape `core/src/field/generators.test.ts` uses, cut to two classes. */
const KIT_TABLE: MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
    {
      id: 1,
      name: "masonry",
      kind: "kit",
      color: [0.5, 0.5, 0.5, 1],
      kit: {
        panelProud: 0.06,
        panelReveal: 0.02,
        collarSection: 0.14,
        backingColor: [0.4, 0.4, 0.4, 1],
        pieceColors: {
          panel: [0.55, 0.53, 0.5, 1],
          floor: [0.42, 0.4, 0.38, 1],
          trim: [0.35, 0.33, 0.3, 1],
          collar: [0.3, 0.28, 0.26, 1],
        },
      },
    },
  ],
};

test("the three module-private numbers the skill quotes are what a hall emits", () => {
  const hall = generatorById("hall");
  const w = hall.defaults["width"] as number;
  const h = hall.defaults["height"] as number;
  const d = hall.defaults["depth"] as number;
  const region = {
    min: [0, 0, 0] as [number, number, number],
    max: [8, 6, 8] as [number, number, number],
  };
  // The one override opens the north door so the aperture exists to measure; params
  // round-trip through the evaluate contract's own parse.
  const { ops } = hall.evaluate(
    { ...hall.defaults, doorNorth: true },
    1,
    region,
    KIT_TABLE,
    "replace",
  );
  const boxes = ops.flatMap((op) =>
    op.kind === "brush" && op.shape.kind === "box"
      ? [
          {
            effect: op.effect,
            center: op.shape.center,
            half: op.shape.halfExtents,
          },
        ]
      : [],
  );
  const fills = boxes.filter((b) => b.effect === "fill");
  // The derivation's own precondition, asserted so a hall that stops emitting one shell
  // fill box reds HERE rather than turning the algebra below into NaN comparisons.
  expect(fills.length).toBe(1);
  const fill = fills[0] as (typeof boxes)[number];
  // (w + s)·c = 2·hx0 and (h + s)·c = 2·hx1 ⇒ subtract: c = 2(hx0 − hx1)/(w − h).
  const cell = r3((2 * (fill.half[0] - fill.half[1])) / (w - h));
  const shellCells = r3((2 * fill.half[0]) / cell - w);
  // Door digs sit past the interior's far-z face (north). Interior far z = fill max z
  // minus one shell's worth; everything here is derived, no magic thresholds.
  const interiorZMax = fill.center[2] + fill.half[2] - (shellCells / 2) * cell;
  const door = boxes.filter(
    (b) =>
      b.effect === "dig" && b.center[2] + b.half[2] > interiorZMax + cell / 4,
  );
  expect(door.length).toBeGreaterThan(0);
  const doorW = r3(
    Math.max(...door.map((b) => b.center[0] + b.half[0])) -
      Math.min(...door.map((b) => b.center[0] - b.half[0])),
  );
  const doorH = r3(
    Math.max(...door.map((b) => b.center[1] + b.half[1])) -
      Math.min(...door.map((b) => b.center[1] - b.half[1])),
  );
  const text = skillText();
  expect({
    // The third axis closes the system: the same cell and shell must reproduce the
    // depth half-extent, or the two-equation solve above fit noise.
    depthConsistent: r3((d + shellCells) * cell) === r3(2 * fill.half[2]),
    // The skill's three spellings, each SEARCHED FOR with the derived value — re-dial
    // `CELL`, the door dims or the shell and the sentence stops being found.
    coarseCell: text.includes(`count coarse cells of ${cell} m`),
    shell:
      shellCells === 2 && text.includes(`one-coarse-cell (${cell} m) shell`),
    door: text.includes(
      `**${doorW.toFixed(1)} m wide × ${doorH.toFixed(1)} m high**`,
    ),
  }).toEqual({
    depthConsistent: true,
    coarseCell: true,
    shell: true,
    door: true,
  });
});

test("the frontmatter declares a name and a description", () => {
  const text = skillText();
  expect(text.startsWith("---\n")).toBe(true);
  const front = text.slice(4, text.indexOf("\n---", 4));
  expect(front).toContain("name: sculpting-worlds");
  expect(/^description: Use when /m.test(front)).toBe(true);
});
