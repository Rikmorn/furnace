// The world verbs: save, bake-as-default, load — the daemon-call orchestration that
// used to live inside the field toolbar's buttons, lifted out so the shell can drive it
// from the world chip, ⌘S, the burger and the drawer without four copies of it.
//
// Both seams are INJECTED rather than reached for (the notify-store precedent): the api
// and the host arrive as arguments, so the call SEQUENCE — which is the part that must
// not drift, because worlds/index.json must never name a world that isn't on disk yet —
// is drivable from a bare test with no DOM and no daemon.
//
// What it does NOT own: the confirm dialog and the world's edit state. A tracked
// overwrite comes back as its own OUTCOME (`needs-tracked-confirm`) for the caller to
// route through the App-owned prompt; the outcomes it CAN finish it reports itself, so
// the message and the call that produced it stay next to each other.
//
// Type-imports only from the viewport host (erased) — the project-first invariant.
import type { FieldManifest } from "@furnace/core/field"; // type-only: erased
import type { FieldHost } from "../../viewport-host/index.ts"; // type-only: erased
import type { api as realApi } from "./api.ts";
import {
  bakeUploadCalls,
  isValidWorldName,
  toWireFiles,
} from "./generation.ts";
import { errorMessage } from "./humanize.ts";
import { notify } from "./notify-store.ts";
import type { UiStore } from "./persist.ts";

/** The host surface these verbs touch — the two methods that read and write a world,
 *  and nothing else. Narrow on purpose: it is what makes the test double three lines
 *  instead of a whole FieldHost. */
export type WorldHost = Pick<FieldHost, "exportArtifact" | "loadWorld">;

/** The daemon surface these verbs touch, derived from the real client so a signature
 *  change there breaks here rather than at runtime. */
export type WorldApi = Pick<
  typeof realApi,
  "generationBake" | "fieldLoad" | "worldList"
>;

export type WorldDeps = { api: WorldApi; host: WorldHost };

/** What a write ended as. `needs-tracked-confirm` is the one the CALLER must act on:
 *  it means the target is a world git would commit, and D-21 requires an explicit
 *  confirmation naming the files before it is overwritten. */
export type SaveOutcome =
  | { status: "saved"; files: number }
  | { status: "invalid-name" }
  | { status: "needs-tracked-confirm" }
  | { status: "failed"; message: string };

export type LoadOutcome =
  | { status: "loaded"; chunks: number }
  | { status: "invalid-name" }
  | { status: "failed"; message: string };

// base64 → bytes: the inverse of toWireFiles' encoder, decoding the density chunk files
// the daemon returns. Per-chunk atob is fine for v0 sizes (each chunk is a 4KiB file).
const base64ToBytes = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

/**
 * Write the host's current world to `worlds/<name>/`, optionally pointing
 * `worlds/index.json` at it (the "make it the game's world" half of a bake).
 *
 * REFUSES a tracked target unless `confirmedTracked` says the user has seen the
 * warning. The tracked flag is read fresh from `world.list` at write time rather than
 * from whatever the drawer last rendered — a stale row is exactly the shape of the
 * clobber this guard exists to prevent.
 */
export async function saveWorld(
  deps: WorldDeps,
  params: { name: string; makeDefault: boolean; confirmedTracked?: boolean },
): Promise<SaveOutcome> {
  const { name, makeDefault } = params;
  const verb = makeDefault ? "bake" : "save";
  // Before the round trip: a bad name cannot become a directory, and a refusal that
  // still talks to the daemon is a refusal that can fail for a second reason.
  if (!isValidWorldName(name)) return { status: "invalid-name" };

  // The tracked PRE-CHECK gets its own try, and the split is the whole point: this
  // failure can promise something the write failure below cannot — that nothing has
  // been written. A single catch spanning both would report a refused pre-check in the
  // same words as a bake that died between the world files and worlds/index.json, and
  // those two call for opposite next moves (retry vs. go look at what is on disk).
  let tracked: boolean | null;
  try {
    const { worlds } = await deps.api.worldList();
    // A missing row is a world that does not exist yet: nothing to overwrite.
    tracked = worlds.find((w) => w.name === name)?.tracked ?? null;
  } catch (err) {
    const message = errorMessage(err);
    notify.error(
      `${verb} refused — could not check whether worlds/${name} is tracked (${message}); nothing was written`,
    );
    return { status: "failed", message };
  }

  // `tracked === true` is the only case that warns. `false` is disposable scratch;
  // `null` is INDETERMINATE (no git repo, or an ambiguous check-ignore answer) and
  // degrades to no warning — the alternative is warning about every world in a project
  // without git, which trains the confirm away.
  if (tracked === true && params.confirmedTracked !== true)
    return { status: "needs-tracked-confirm" };

  // The check→write window is real and NOT closed: `worlds/<name>` could become tracked
  // (a `git add`, a .gitignore edit) between the read above and the upload below, and on
  // the confirm path a whole user decision sits in the middle of it. Accepted posture —
  // this is a single-user tool driving a local daemon, so closing it would mean the
  // daemon re-checking under a lock it has no reason to own. The guard's job is to stop
  // the clobber the user can't see coming, not to be atomic against their other hand.

  try {
    // The upload sequence (D-W3-9): the world's file set cleanDir'd to its own
    // directory so a re-bake leaves no orphans, then — only when making it default —
    // worlds/index.json with no cleanDir. ORDERED: the index never names a world that
    // is not on disk yet.
    const calls = bakeUploadCalls(
      toWireFiles(deps.host.exportArtifact(name)),
      `worlds/${name}`,
      name,
      makeDefault,
    );
    const results: { files: number }[] = [];
    for (const call of calls)
      results.push(await deps.api.generationBake(call.files, call.cleanDir));
    const files = results[0]?.files ?? 0;
    notify.success(
      makeDefault
        ? `baked ${files} files — now the game's world`
        : `saved ${files} files → worlds/${name}`,
    );
    return { status: "saved", files };
  } catch (err) {
    // Deliberately NOT promising anything about the state on disk: by here the first
    // call may have cleanDir'd the world's directory and written part of it, or the
    // world may be whole with worlds/index.json still naming the old default.
    const message = errorMessage(err);
    notify.error(`${verb} failed: ${message}`);
    return { status: "failed", message };
  }
}

/** Read a saved v2 world off the daemon and install it on the host. */
export async function loadWorldInto(
  deps: WorldDeps,
  params: { name: string },
): Promise<LoadOutcome> {
  const { name } = params;
  if (!isValidWorldName(name)) return { status: "invalid-name" };
  try {
    const res = await deps.api.fieldLoad(name);
    deps.host.loadWorld({
      // Boundary cast: field.load returns the manifest as opaque JSON; it is the v2
      // FieldManifest the host wrote (bakeFieldWorld) — loadWorld re-validates cellSize.
      manifest: res.manifest as FieldManifest,
      chunks: res.chunks.map((c) => ({
        key: c.key,
        bytes: base64ToBytes(c.data),
      })),
      // Material siblings decode the same way (base64 → bytes); empty for a rock-only
      // world. Threading them reaches store.materials so a painted/filled world renders
      // with its classes in the editor.
      materials: res.materials.map((m) => ({
        key: m.key,
        bytes: base64ToBytes(m.data),
      })),
      // Raw oplog text — the HOST parses it (field.parseOps maps legacy F1 `kind:"dig"`
      // ops forward; the chrome can't value-import parseOps).
      oplog: res.oplog,
    });
    notify.success(`loaded ${name} (${res.chunks.length} chunks)`);
    return { status: "loaded", chunks: res.chunks.length };
  } catch (err) {
    const message = errorMessage(err);
    notify.error(`load failed: ${message}`);
    return { status: "failed", message };
  }
}

/** Record `name` as the world this project was last in — what {@link worldToRestore}
 *  reads back on the next boot. A no-op without a store: persistence is best-effort (the
 *  store is undefined until `project.get` resolves, and forever if it fails). */
export function rememberWorld(store: UiStore | undefined, name: string): void {
  if (!store) return;
  store.set("lastWorld", name);
}

/**
 * The world a boot should reopen, or `null` for "stay on the untitled scratch".
 *
 * `lastWorld` is a HINT about a previous session, not a claim about the disk: the
 * directory it names can be renamed, deleted or swapped by a checkout between runs. So
 * it is checked against `world.list` before anything is loaded, and every miss —
 * unlisted, `legacy` (only v2 worlds have the oplog `field.load` reads, which is why the
 * drawer disables their Open too), or a list call that failed outright — answers `null`
 * SILENTLY. Nobody asked for this open; an error about a world the user themselves
 * deleted would spend one of three toast slots on a non-event, at the one moment the
 * editor is coming up. The untitled scratch on screen says what happened.
 *
 * No `lastWorld` (a first-ever boot) and no store at all (a `project.get` that never
 * resolved) short-circuit before the round trip: a boot with nothing to reopen must not
 * pay for a list it has nothing to look up in.
 */
export async function worldToRestore(
  deps: { api: Pick<WorldApi, "worldList"> },
  store: UiStore | undefined,
): Promise<string | null> {
  const last = store?.get("lastWorld");
  if (!last) return null;
  try {
    const { worlds } = await deps.api.worldList();
    const row = worlds.find((w) => w.name === last);
    return row?.kind === "field" ? last : null;
  } catch {
    return null;
  }
}
