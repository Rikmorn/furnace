// The Field panel's persistence toolbar (extracted from FieldPanel, F2b
// sweep): the world-name input + New / Load / Save / Bake-as-default + the
// headlamp toggle, plus the run-once catalog fetch that installs the
// project's resolved material table on the host. Owns the name / busy /
// catalog-settled state — the panel consumes only the parsed table (onTable)
// and the status line (onStatus, rendered in the panel footer). Reaches the
// App-owned host through the editor context ref, exactly like the panel —
// the chrome never value-imports engine code (the project-first invariant);
// this file type-imports the artifact types (erased) and value-imports the
// catalog parser from a frontend lib that itself only type-imports core.
import type { FieldManifest, MaterialTable } from "@furnace/core/field"; // type-only: erased
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
// catalog.ts type-imports core only (erased), so value-importing it here does
// NOT pull core into the chrome bundle — the project-first invariant holds.
import { CatalogError, parseMaterialsCatalog } from "../../lib/catalog.ts";
import { cn } from "../../lib/cn.ts";
import { bakeUploadCalls, toWireFiles } from "../../lib/generation.ts";
import { useEditor } from "../editor-context.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { errorMessage, ReasonTip } from "../world-panel/fields.tsx";

// Mirrors the daemon field.load name regex AND FieldHost's clamp range. Name is EMPTY by
// default and never prefilled (the W3/W4 gate-clobber lesson: a stale default silently
// overwrites the game's world on Save/Bake).
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

// base64 → bytes: the inverse of toWireFiles' encoder, decoding the density chunk files
// the daemon returns. Per-chunk atob is fine for v0 sizes (each chunk is a 4KiB file).
const base64ToBytes = (b64: string): Uint8Array =>
	Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

export function FieldToolbar(props: {
	/** The panel's headlamp state — the toolbar renders the toggle, the panel owns it. */
	headlamp: boolean;
	/** Flip the host's shading mode (headlamp on/off). */
	onShading: (on: boolean) => void;
	/** Adopt the parsed catalog table (drives the panel's swatches + mask options). */
	onTable: (table: MaterialTable) => void;
	/** The panel's status line (rendered in its footer). */
	onStatus: (msg: string) => void;
}) {
	const { state, fieldHostRef } = useEditor();
	const { onTable, onStatus } = props;
	const catalogLoaded = useRef(false);
	const [name, setName] = useState("");
	// True once the catalog fetch reached ANY outcome (success / 404 / error) —
	// Load waits for it so a world never remeshes against the wrong table
	// (carry-over #2: the settle can land before OR after engine init; both
	// orders converge, but a Load racing the fetch would not).
	const [catalogSettled, setCatalogSettled] = useState(false);
	const [busy, setBusy] = useState(false);

	const nameValid = NAME_RE.test(name);

	// Catalog load, run-once on engine-ready. Fetches the project's materials catalog
	// (the daemon maps this chrome-miss GET onto the project root) and installs the
	// resolved table on the host — BEFORE any world Load, so a v2 world baked against
	// this same catalog remeshes with the right classes. A 404 leaves the host on its
	// rock-only BUILTIN_TABLE default; a CatalogError is setup-loud (its JSON path
	// shows in the status line so a mistyped catalog is diagnosable here). The host
	// may not be GPU-init'd yet — setMaterialTable then just stores the table (no
	// rebuild) and init() picks it up; if init ran first, the swap re-meshes. Either
	// order converges. fieldHostRef.current is assigned before engine-ready (App), so
	// it is present whenever state.status === "ready". EVERY outcome settles the
	// catalog (finally) — the Load gate must never wedge shut on a failed fetch.
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready" || catalogLoaded.current) return;
		catalogLoaded.current = true;
		void (async () => {
			try {
				const res = await fetch("/catalog/materials.json");
				if (res.status === 404) {
					onStatus("no catalog — rock only");
					return;
				}
				if (!res.ok) {
					onStatus(`catalog fetch failed (${res.status})`);
					return;
				}
				const parsed = parseMaterialsCatalog(await res.text());
				host.setMaterialTable(parsed);
				onTable(parsed);
				onStatus(`materials: ${parsed.classes.length} classes`);
			} catch (err) {
				if (err instanceof CatalogError) {
					onStatus(
						`catalog error at "${err.path || "(root)"}": ${err.message}`,
					);
					return;
				}
				onStatus(`catalog load failed: ${errorMessage(err)}`);
			} finally {
				setCatalogSettled(true);
			}
		})();
	}, [state.status, fieldHostRef, onTable, onStatus]);

	const onNew = (): void => {
		fieldHostRef.current?.newWorld();
		onStatus("new world — all solid rock");
	};

	const onSave = async (): Promise<void> => {
		const host = fieldHostRef.current;
		if (!host || !nameValid) return;
		setBusy(true);
		onStatus(`saving ${name}…`);
		try {
			const files = toWireFiles(host.exportArtifact(name));
			const res = await api.generationBake(files, `worlds/${name}`);
			onStatus(`saved ${res.files} files → worlds/${name}`);
		} catch (err) {
			onStatus(`save failed: ${errorMessage(err)}`);
		} finally {
			setBusy(false);
		}
	};

	const onBakeDefault = async (): Promise<void> => {
		const host = fieldHostRef.current;
		if (!host || !nameValid) return;
		setBusy(true);
		onStatus(`baking ${name} as the game's world…`);
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
			onStatus(`baked ${results[0]?.files ?? 0} files — now the game's world`);
		} catch (err) {
			onStatus(`bake failed: ${errorMessage(err)}`);
		} finally {
			setBusy(false);
		}
	};

	const onLoad = async (): Promise<void> => {
		const host = fieldHostRef.current;
		if (!host || !nameValid) return;
		setBusy(true);
		onStatus(`loading ${name}…`);
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
			onStatus(`loaded ${name} (${res.chunks.length} chunks)`);
		} catch (err) {
			onStatus(`load failed: ${errorMessage(err)}`);
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
