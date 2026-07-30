// The Field panel's persistence toolbar (extracted from FieldPanel, F2b
// sweep): the world-name input + New / Load / Save / Bake-as-default + the
// headlamp toggle, plus the run-once catalog fetch that installs the project's
// resolved material table, its entity catalog AND its agent profile on the
// host. Owns the name / busy / catalog-settled state — the panel consumes the parsed
// table (onTable) and the entity-catalog signal (onEntityCatalogInstalled).
// Everything it has to SAY goes to the notification store (Task 7): each report is
// its own toast and its own log entry, toned by outcome, instead of overwriting a
// shared footer line. Reaches the App-owned host through the editor context ref,
// exactly like the panel — the chrome never value-imports engine code (the
// project-first invariant); this file type-imports the artifact types (erased) and
// value-imports the catalog parser from a frontend lib that itself only type-imports
// core.
import type { FieldManifest, MaterialTable } from "@furnace/core/field"; // type-only: erased
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
// catalog.ts type-imports core only (erased), so value-importing it here does
// NOT pull core into the chrome bundle — the project-first invariant holds.
import {
	CatalogError,
	parseAgentCatalog,
	parseEntityCatalog,
	parseMaterialsCatalog,
} from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { bakeUploadCalls, toWireFiles } from "../../lib/generation.ts";
import { notify } from "../../lib/notify-store.ts";
import { useEditor } from "../editor-context.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { errorMessage, ReasonTip } from "./form-bits.tsx";

// Mirrors the daemon field.load name regex AND FieldHost's clamp range. Name is EMPTY by
// default and never prefilled (the W3/W4 gate-clobber lesson: a stale default silently
// overwrites the game's world on Save/Bake).
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

// base64 → bytes: the inverse of toWireFiles' encoder, decoding the density chunk files
// the daemon returns. Per-chunk atob is fine for v0 sizes (each chunk is a 4KiB file).
const base64ToBytes = (b64: string): Uint8Array =>
	Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

/** One catalog outcome, carried rather than posted, because the three loaders run
 *  concurrently and the ORDER they are said in is decided by their caller. */
type Report = { severity: "info" | "error"; text: string };
const info = (text: string): Report => ({ severity: "info", text });
const bad = (text: string): Report => ({ severity: "error", text });
const post = (report: Report): void => {
	if (report.severity === "error") notify.error(report.text);
	else notify.info(report.text);
};

export function FieldToolbar(props: {
	/** The panel's headlamp state — the toolbar renders the toggle, the panel owns it. */
	headlamp: boolean;
	/** Flip the host's shading mode (headlamp on/off). */
	onShading: (on: boolean) => void;
	/** Adopt the parsed catalog table (drives the panel's swatches + mask options). */
	onTable: (table: MaterialTable) => void;
	/** Fired once the ENTITY catalog is installed on the host, so the panel can
	 *  re-read the generator registry. The toolbar owns the install; the panel
	 *  needs the signal because `host.listGenerators()` is a snapshot — the
	 *  `archetypeId` picker options only exist in schemas read after this lands,
	 *  and the panel reads them at engine-ready, which is necessarily before this
	 *  async fetch settles.
	 *
	 *  Deliberately CARRIES NOTHING. Handing over the parsed catalog would invite
	 *  a consumer to read it instead of re-reading the host — which is precisely
	 *  the stale-snapshot bug this callback exists to prevent. The host is the one
	 *  source of truth; this is only the "ask it again" tick. */
	onEntityCatalogInstalled: () => void;
}) {
	const { state, fieldHostRef } = useEditor();
	const { onTable, onEntityCatalogInstalled } = props;
	const catalogLoaded = useRef(false);
	const [name, setName] = useState("");
	// True once the catalog fetch reached ANY outcome (success / 404 / error) —
	// Load waits for it so a world never remeshes against the wrong table
	// (carry-over #2: the settle can land before OR after engine init; both
	// orders converge, but a Load racing the fetch would not).
	const [catalogSettled, setCatalogSettled] = useState(false);
	const [busy, setBusy] = useState(false);

	const nameValid = NAME_RE.test(name);

	// Catalog load, run-once on engine-ready — ALL THREE project catalogs in one pass.
	// Materials come first and alone gate Load: a v2 world must remesh against the same
	// table it was baked with. The entity and agent catalogs gate nothing (props render
	// from the op log whether or not the first resolves; the advisor simply stays off
	// without the second), so they run after the gate has settled and report separately.
	//
	// The daemon maps these chrome-miss GETs onto the project root. A 404 leaves the
	// host on its rock-only BUILTIN_TABLE / no-archetypes / no-profile defaults; a
	// CatalogError is setup-loud (its JSON path shows in the message so a mistyped
	// catalog is diagnosable here, and the log keeps it after the toast goes). The host may not be GPU-init'd yet — the
	// setters then just store (no rebuild) and init() picks them up; if init ran
	// first, the swap re-meshes. Either order converges. fieldHostRef.current is
	// assigned before engine-ready (App), so it is present whenever
	// state.status === "ready". EVERY materials outcome settles the gate (finally) —
	// Load must never wedge shut on a failed fetch.
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready" || catalogLoaded.current) return;
		catalogLoaded.current = true;

		const loadMaterials = async (): Promise<Report> => {
			const res = await fetch("/catalog/materials.json");
			if (res.status === 404) return info("no catalog — rock only");
			if (!res.ok) return bad(`catalog fetch failed (${res.status})`);
			const parsed = parseMaterialsCatalog(await res.text());
			host.setMaterialTable(parsed);
			onTable(parsed);
			return info(`materials: ${parsed.classes.length} classes`);
		};

		// Never throws — an entity-catalog problem is diagnostic text, never a
		// reason to leave the panel without its material table.
		const loadEntities = async (): Promise<Report | null> => {
			try {
				const res = await fetch("/catalog/entities.json");
				// 404 is the ordinary case for a project with no props at all —
				// silent, not a warning. Scatter still runs on its schema defaults.
				if (res.status === 404) return null;
				if (!res.ok) return bad(`entities fetch failed (${res.status})`);
				const parsed = parseEntityCatalog(await res.text());
				host.setEntityCatalog(parsed);
				onEntityCatalogInstalled(); // AFTER the install — the panel re-reads the host
				return info(`props: ${parsed.archetypes.length} archetypes`);
			} catch (err) {
				return bad(
					err instanceof CatalogError
						? `entities error at "${err.path || "(root)"}": ${err.message}`
						: `entities load failed: ${errorMessage(err)}`,
				);
			}
		};

		// The walkability advisor's premise (D-F4-4). Never throws, like the entity
		// load, and SILENT on both good outcomes: a parsed profile shows itself in
		// the advisor's markers, and a 404 is a project that simply has no agent —
		// one the host already reports as "advisor idle" at the first edit that
		// would have analysed, which is a better moment than load. Only a MALFORMED
		// catalog has something to say here, and it must be said: nothing else
		// would tell the user why the advisor never lit up.
		const loadAgent = async (): Promise<Report | null> => {
			try {
				const res = await fetch("/catalog/agent.json");
				if (res.status === 404) return null;
				if (!res.ok) return bad(`agent fetch failed (${res.status})`);
				host.setAgentProfile(parseAgentCatalog(await res.text()));
				return null;
			} catch (err) {
				return bad(
					err instanceof CatalogError
						? `agent error at "${err.path || "(root)"}": ${err.message}`
						: `agent load failed: ${errorMessage(err)}`,
				);
			}
		};

		void (async () => {
			let materials: Report;
			try {
				materials = await loadMaterials();
			} catch (err) {
				materials = bad(
					err instanceof CatalogError
						? `catalog error at "${err.path || "(root)"}": ${err.message}`
						: `catalog load failed: ${errorMessage(err)}`,
				);
			} finally {
				setCatalogSettled(true);
			}
			// Report the materials outcome the moment it is known — a slow (or wedged)
			// entities fetch must not hold back the message about the catalog that
			// actually gates Load — then whatever the two NON-GATING catalogs have to
			// say, each as its OWN message. The F2b-era composition (one line rebuilt
			// with the extras appended, guarded by a sequence so a New/Load/Save landing
			// mid-fetch could not be clobbered) died with the shared line it protected:
			// messages accumulate now instead of overwriting, and a re-posted composite
			// would just be the materials outcome said twice.
			post(materials);
			for (const extra of await Promise.all([loadEntities(), loadAgent()]))
				if (extra) post(extra);
		})();
	}, [state.status, fieldHostRef, onTable, onEntityCatalogInstalled]);

	const onNew = (): void => {
		fieldHostRef.current?.newWorld();
		notify.info("new world — all solid rock");
	};

	// The three long verbs report their OUTCOME and nothing else — no "saving…" toast in
	// front of it. Three reasons, and the third is the load-bearing one:
	//   1. in-flight is already said AT the control (`busy` disables the whole row), which
	//      is where the user is looking when they press it;
	//   2. D-19's mechanism for a long job is a progress chip with a cooperative cancel
	//      (F4.5c), not a toast that cannot be acted on;
	//   3. the stack caps at 3 and NEVER evicts, so a progress toast is a slot held by a
	//      message about something that has already finished — with three of them the
	//      outcome that matters ("saved 12 files") is the thing that gets suppressed.
	//      Outcomes must always land; that is what the whole channel is for.
	const onSave = async (): Promise<void> => {
		const host = fieldHostRef.current;
		if (!host || !nameValid) return;
		setBusy(true);
		try {
			const files = toWireFiles(host.exportArtifact(name));
			const res = await api.generationBake(files, `worlds/${name}`);
			notify.success(`saved ${res.files} files → worlds/${name}`);
		} catch (err) {
			notify.error(`save failed: ${errorMessage(err)}`);
		} finally {
			setBusy(false);
		}
	};

	const onBakeDefault = async (): Promise<void> => {
		const host = fieldHostRef.current;
		if (!host || !nameValid) return;
		setBusy(true);
		try {
			// Reuse the world flow's upload sequence: the world's file set (cleanDir'd to its own
			// dir so a re-bake leaves no orphans), then worlds/index.json pointed at it
			// (byte-identical to the committed format). Ordered — index.json never names a world
			// not yet on disk.
			const calls = bakeUploadCalls(
				toWireFiles(host.exportArtifact(name)),
				`worlds/${name}`,
				name,
				true,
			);
			const results: { files: number }[] = [];
			for (const call of calls) {
				results.push(await api.generationBake(call.files, call.cleanDir));
			}
			notify.success(
				`baked ${results[0]?.files ?? 0} files — now the game's world`,
			);
		} catch (err) {
			notify.error(`bake failed: ${errorMessage(err)}`);
		} finally {
			setBusy(false);
		}
	};

	const onLoad = async (): Promise<void> => {
		const host = fieldHostRef.current;
		if (!host || !nameValid) return;
		setBusy(true);
		try {
			const res = await api.fieldLoad(name);
			host.loadWorld({
				// Boundary cast: field.load returns the manifest as opaque JSON; it is the
				// v2 FieldManifest the host wrote (bakeFieldWorld) — loadWorld re-validates cellSize.
				manifest: res.manifest as FieldManifest,
				chunks: res.chunks.map((c) => ({
					key: c.key,
					bytes: base64ToBytes(c.data),
				})),
				// Material siblings decode the same way (base64 → bytes); empty for a
				// rock-only world. Threading them reaches store.materials so a painted/
				// filled world renders with its classes in the editor.
				materials: res.materials.map((m) => ({
					key: m.key,
					bytes: base64ToBytes(m.data),
				})),
				// Raw oplog text — the HOST parses it (field.parseOps maps legacy F1
				// `kind:"dig"` ops forward; the chrome can't value-import parseOps).
				oplog: res.oplog,
			});
			notify.success(`loaded ${name} (${res.chunks.length} chunks)`);
		} catch (err) {
			notify.error(`load failed: ${errorMessage(err)}`);
		} finally {
			setBusy(false);
		}
	};

	const nameInvalid = name !== "" && !nameValid;

	return (
		<div className="flex flex-wrap items-center gap-2 border-b border-border p-2 text-sm">
			<Input
				type="text"
				value={name}
				placeholder="world name"
				onChange={(e) => setName(e.target.value)}
				disabled={busy}
				aria-invalid={nameInvalid}
				aria-label="world name"
				className={cn("h-8 w-36", nameInvalid && "border-destructive")}
			/>
			<Button
				type="button"
				size="sm"
				variant="secondary"
				disabled={busy}
				onClick={onNew}
			>
				New
			</Button>
			{/* ReasonTip, not a bare title: the Button's disabled:pointer-events-none
          would swallow the tooltip that explains the catalog gate. */}
			<ReasonTip
				reason={
					catalogSettled
						? undefined
						: "waiting for the materials catalog — Load resolves world classes against it"
				}
			>
				<Button
					type="button"
					size="sm"
					variant="secondary"
					disabled={busy || !nameValid || !catalogSettled}
					onClick={() => void onLoad()}
				>
					Load
				</Button>
			</ReasonTip>
			<Button
				type="button"
				size="sm"
				disabled={busy || !nameValid}
				onClick={() => void onSave()}
			>
				Save
			</Button>
			{/* Bake keeps the World panel's commit-to-disk success colour (tailwind-merge lets
          the className override the default primary fill). */}
			<Button
				type="button"
				size="sm"
				disabled={busy || !nameValid}
				onClick={() => void onBakeDefault()}
				className="bg-success text-success-foreground hover:bg-success/90"
			>
				Bake &amp; make default
			</Button>
			<label className="flex items-center gap-1.5 text-muted-foreground">
				<input
					type="checkbox"
					checked={props.headlamp}
					onChange={(e) => props.onShading(e.target.checked)}
				/>
				headlamp
			</label>
		</div>
	);
}
