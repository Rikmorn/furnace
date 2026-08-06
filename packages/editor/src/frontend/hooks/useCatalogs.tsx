// The project's three catalogs — materials, entities, agent — fetched ONCE at
// engine-ready and installed on the field host.
//
// It ran inside the field toolbar until the world verbs left it (F4.5a Task 8), which
// is the wrong place for two reasons: the fetch has to happen whether or not any
// palette holding that toolbar is open, and TWO surfaces need its result — the panel
// wants the parsed material table, the world drawer wants the settled flag that gates
// Load. So it is a provider now, mounted once by the shell.
//
// The daemon maps these chrome-miss GETs onto the project root. A 404 leaves the host on
// its rock-only BUILTIN_TABLE / no-archetypes / no-profile defaults; a CatalogError is
// setup-loud (its JSON path shows in the message so a mistyped catalog is diagnosable,
// and the log keeps it after the toast goes).
import type { MaterialTable } from "@furnace/core/field"; // type-only: erased
import type { ReactNode } from "react";
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
// catalog.ts type-imports core only (erased), so value-importing it here does NOT pull
// core into the chrome bundle — the project-first invariant holds.
import {
	CatalogError,
	parseAgentCatalog,
	parseEntityCatalog,
	parseMaterialsCatalog,
} from "../../shared/catalog.ts";
import { useEditor } from "../components/editor-context.ts";
import { errorMessage } from "../lib/humanize.ts";
import { notify } from "../lib/notify-store.ts";

/** What the swatches and mask options fall back to before the catalog resolves and when
 *  there is none (404): rock only. A LOCAL literal — the chrome can't value-import
 *  core's BUILTIN_TABLE (frontend-no-engine-leakage). The host keeps its own
 *  BUILTIN_TABLE default; this only feeds the panel's material UI. */
const ROCK_ONLY_TABLE: MaterialTable = {
	classes: [
		{ id: 0, name: "rock", kind: "organic", color: [0.62, 0.6, 0.58, 1] },
	],
};

export type CatalogState = {
	/** The project's resolved material classes, or rock-only until/unless one lands. */
	table: MaterialTable;
	/** True once the MATERIALS fetch reached ANY outcome (success / 404 / error). Load
	 *  waits for it so a world never remeshes against the wrong table (the settle can
	 *  land before OR after engine init; both orders converge, but a Load racing the
	 *  fetch would not). */
	catalogSettled: boolean;
	/** Bumped once the ENTITY catalog is installed on the host, so the field panel can
	 *  re-read the generator registry: `host.listGenerators()` is a SNAPSHOT, the
	 *  `archetypeId` picker options only exist in schemas read after this lands, and the
	 *  panel reads them at engine-ready — necessarily before this async fetch settles.
	 *
	 *  Deliberately carries NOTHING. Handing over the parsed catalog would invite a
	 *  consumer to read it instead of re-reading the host, which is exactly the
	 *  stale-snapshot bug this tick exists to prevent. */
	entityCatalogTick: number;
};

const NO_CATALOG: CatalogState = {
	table: ROCK_ONLY_TABLE,
	catalogSettled: false,
	entityCatalogTick: 0,
};

const CatalogContext = createContext<CatalogState>(NO_CATALOG);

/** Read the project's catalogs. Defaults to rock-only-and-unsettled rather than throwing
 *  outside the provider: a panel mounted on its own (the harness tests do exactly that)
 *  has no fetch behind it, and "no catalog" is the truth in that case rather than a
 *  wiring bug worth crashing over — the CameraPoseContext precedent. */
export function useCatalog(): CatalogState {
	return useContext(CatalogContext);
}

/** One catalog outcome, carried rather than posted, because the three loaders run
 *  concurrently and the ORDER they are said in is decided by their caller. */
type Report = { severity: "info" | "error"; text: string };
const info = (text: string): Report => ({ severity: "info", text });
const bad = (text: string): Report => ({ severity: "error", text });
const post = (report: Report): void => {
	if (report.severity === "error") notify.error(report.text);
	else notify.info(report.text);
};

export function CatalogProvider({ children }: { children: ReactNode }) {
	const { state, fieldHostRef } = useEditor();
	const [table, setTable] = useState<MaterialTable>(ROCK_ONLY_TABLE);
	const [catalogSettled, setCatalogSettled] = useState(false);
	const [entityCatalogTick, setEntityCatalogTick] = useState(0);

	// Run-once on engine-ready — ALL THREE project catalogs in one pass. Materials come
	// first and alone gate Load: a v2 world must remesh against the same table it was
	// baked with. The entity and agent catalogs gate nothing (props render from the op
	// log whether or not the first resolves; the advisor simply stays off without the
	// second), so they run after the gate has settled and report separately.
	//
	// The host may not be GPU-init'd yet — the setters then just store (no rebuild) and
	// init() picks them up; if init ran first, the swap re-meshes. Either order
	// converges. fieldHostRef.current is assigned before engine-ready (App), so it is
	// present whenever state.status === "ready". EVERY materials outcome settles the
	// gate (finally) — Load must never wedge shut on a failed fetch.
	//
	// `[]` deps would be wrong (the status arrives late), so the effect re-runs on the
	// status and a ref latches the one pass that matters: re-fetching three catalogs
	// because a render happened is what this guard prevents.
	const loaded = useRef(false);
	useEffect(() => {
		const host = fieldHostRef.current;
		if (!host || state.status !== "ready" || loaded.current) return;
		loaded.current = true;

		const loadMaterials = async (): Promise<Report> => {
			const res = await fetch("/catalog/materials.json");
			if (res.status === 404) return info("no catalog — rock only");
			if (!res.ok) return bad(`catalog fetch failed (${res.status})`);
			const parsed = parseMaterialsCatalog(await res.text());
			host.setMaterialTable(parsed);
			setTable(parsed);
			return info(`materials: ${parsed.classes.length} classes`);
		};

		// Never throws — an entity-catalog problem is diagnostic text, never a reason to
		// leave the panel without its material table.
		const loadEntities = async (): Promise<Report | null> => {
			try {
				const res = await fetch("/catalog/entities.json");
				// 404 is the ordinary case for a project with no props at all — silent, not
				// a warning. Scatter still runs on its schema defaults.
				if (res.status === 404) return null;
				if (!res.ok) return bad(`entities fetch failed (${res.status})`);
				const parsed = parseEntityCatalog(await res.text());
				host.setEntityCatalog(parsed);
				setEntityCatalogTick((n) => n + 1); // AFTER the install — consumers re-read the host
				return info(`props: ${parsed.archetypes.length} archetypes`);
			} catch (err) {
				return bad(
					err instanceof CatalogError
						? `entities error at "${err.path || "(root)"}": ${err.message}`
						: `entities load failed: ${errorMessage(err)}`,
				);
			}
		};

		// The walkability advisor's premise (D-F4-4). Never throws, like the entity load,
		// and SILENT on both good outcomes: a parsed profile shows itself in the advisor's
		// markers, and a 404 is a project that simply has no agent — one the host reports
		// as "advisor idle" at the first edit that would have analysed, which is a better
		// moment than load. Only a MALFORMED catalog has something to say here, and it
		// must be said: nothing else would tell the user why the advisor never lit up.
		//
		// BOTH answers go to the host, and that is the point rather than a formality. The
		// host's `agentProfile === null` reads the same while this fetch is in flight as it
		// does for a project with no agent, and it is what the idle notice is decided on —
		// so with only the positive answer wired the notice states, permanently and
		// one-shot, whichever of the two arrivals happened to win. `setAgentProfile(null)`
		// is the negative one: "asked, and this project has none".
		//
		// Only the 404 may send it. A failed fetch does not KNOW (a 500 over a project that
		// ships a fine agent.json is the ordinary case), and a malformed catalog knows the
		// opposite — the project installs one, it is just unusable. Both already said what
		// happened, with the status or the JSON path in the line; "advisor idle — this
		// project installs no agent profile" would be a second, less true account of it.
		const loadAgent = async (): Promise<Report | null> => {
			try {
				const res = await fetch("/catalog/agent.json");
				if (res.status === 404) {
					host.setAgentProfile(null);
					return null;
				}
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
			// entities fetch must not hold back the message about the catalog that actually
			// gates Load — then whatever the two NON-GATING catalogs have to say, each as
			// its OWN message.
			post(materials);
			for (const extra of await Promise.all([loadEntities(), loadAgent()]))
				if (extra) post(extra);
		})();
	}, [state.status, fieldHostRef]);

	const value = useMemo<CatalogState>(
		() => ({ table, catalogSettled, entityCatalogTick }),
		[table, catalogSettled, entityCatalogTick],
	);
	return (
		<CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
	);
}
