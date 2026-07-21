// Harness tests for the World panel (W3): empty-draft CTA, Generate wiring through
// draftToSpec, busy gating, freeze snapshot gating, per-region reroll, the freeze upload
// sequence, and the failure line. Mock EditorContext, fake worker client, stub PreviewHost
// — the real worker never spawns in bun test, and the stub host only has to be
// non-undefined (the fake client never invokes onWorld, so previewWorld's GPU path is
// never reached). The session is REAL React state here, so status transitions
// (generating → baked / failed) are observable in the DOM.

import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { useState } from "react";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { WorldPanel } from "../../src/frontend/components/WorldPanel.tsx";
import { api } from "../../src/frontend/lib/api.ts";
import {
	initialWorldSession,
	type WorldGenSession,
} from "../../src/frontend/lib/generation.ts";
import type { GenerationWorkerClient } from "../../src/frontend/lib/generation-client.ts";
import {
	addRegion,
	type WorldDraft,
} from "../../src/frontend/lib/world-draft.ts";
import type { PreviewHost } from "../../src/viewport-host/index.ts";
import {
	cleanup,
	fireEvent,
	makeEditorContext,
	render,
	screen,
	waitFor,
} from "../inspector/_harness.tsx";

afterEach(cleanup);

/** A one-cave draft (a cave anchor is a valid single-region world — mouths are portals). */
function caveDraft(): WorldDraft {
	return addRegion(
		{ name: "w1", regions: [], startRegionId: "" },
		{ id: "cave-1", algorithm: "cave", knobs: { mouths: 1 }, seed: "cave-1" },
	);
}

/** hall-1 with TWO caves bored off the SAME parent portal — legal to ASSEMBLE (addRegion
 *  only checks the class pair), but draftToSpec refuses it: one portal, two connectors. */
function doubleClaimedPortalDraft(): WorldDraft {
	const bore = {
		kind: "collar-bore",
		parentId: "hall-1",
		parentPortal: { wall: "north", offset: 2 },
		childPortal: { mouth: 0 },
	} as const;
	let d: WorldDraft = { name: "w1", regions: [], startRegionId: "" };
	d = addRegion(d, {
		id: "hall-1",
		algorithm: "hall",
		knobs: { size: [8, 6, 8], pillars: { kind: "none" } },
		seed: "hall-1",
	});
	d = addRegion(d, {
		id: "cave-1",
		algorithm: "cave",
		knobs: { mouths: 1 },
		seed: "cave-1",
		attachment: { ...bore },
	});
	return addRegion(d, {
		id: "cave-2",
		algorithm: "cave",
		knobs: { mouths: 1 },
		seed: "cave-2",
		attachment: { ...bore },
	});
}

type FakeClient = {
	runWorld: ReturnType<typeof mock>;
	bakeWorld: ReturnType<typeof mock>;
	cancel: ReturnType<typeof mock>;
};

/** The panel over a REAL session state cell — the App-owned setter, faked at panel scope
 *  so a click's status transition is observable. */
function Harness(props: { initial: WorldGenSession; client: FakeClient }) {
	const [session, setSession] = useState(props.initial);
	const ctx = makeEditorContext({
		state: { generationActive: true },
		previewHostRef: { current: {} as PreviewHost },
		extensions: {
			realizeRegion: () => Promise.resolve({}),
			MaterialCache: class {
				// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
				destroy(): void {}
			},
			worldDir: (name: string) => `worlds/${name}`,
		},
		generation: {
			session,
			setSession,
			client: props.client as unknown as GenerationWorkerClient,
		},
	});
	return (
		<EditorContext.Provider value={ctx}>
			<WorldPanel />
		</EditorContext.Provider>
	);
}

function renderPanel(overrides?: {
	session?: Partial<WorldGenSession>;
	client?: Partial<FakeClient>;
}) {
	const client: FakeClient = {
		runWorld: mock(),
		bakeWorld: mock(),
		cancel: mock(),
		...overrides?.client,
	};
	render(
		<Harness
			initial={{ ...initialWorldSession(), ...overrides?.session }}
			client={client}
		/>,
	);
	return { client };
}

const button = (name: string): HTMLButtonElement =>
	screen.getByRole("button", { name }) as HTMLButtonElement;

test("empty draft: name field + Add region form render; Generate is disabled", () => {
	renderPanel();
	expect(screen.getByLabelText("World Name")).toBeTruthy();
	expect(button("Add region")).toBeTruthy();
	expect(button("Generate").disabled).toBe(true);
});

test("Generate compiles the draft through draftToSpec and hands it to runWorld", () => {
	const { client } = renderPanel({ session: { draft: caveDraft() } });
	fireEvent.click(button("Generate"));
	expect(client.runWorld).toHaveBeenCalled();
	// Boundary: the mock records the exact spec the panel built.
	const spec = client.runWorld.mock.calls[0]?.[0] as {
		regions: { id: string; class: string }[];
		startRegion: string;
	};
	expect(spec.regions.map((r) => r.id)).toEqual(["cave-1"]);
	expect(spec.regions[0]?.class).toBe("field-organic");
	expect(spec.startRegion).toBe("cave-1");
});

test("Generate is disabled while generating", () => {
	renderPanel({
		session: { draft: caveDraft(), status: { phase: "generating" } },
	});
	expect(button("Generate").disabled).toBe(true);
});

test("Reroll bumps ONE region's seed and regenerates from the bumped draft (D-W3-8)", () => {
	const { client } = renderPanel({ session: { draft: caveDraft() } });
	fireEvent.click(button("Reroll"));
	// The reroll regenerates immediately — from the BUMPED draft, not the stale session one
	// (React state updates are async, so the panel passes the new draft explicitly).
	const spec = client.runWorld.mock.calls[0]?.[0] as {
		regions: { id: string; seed: string }[];
	};
	expect(spec.regions[0]?.seed).toBe("cave-2");
	// …and the bump landed in the draft the user keeps editing.
	expect((screen.getByLabelText("cave-1 seed") as HTMLInputElement).value).toBe(
		"cave-2",
	);
});

test("Freeze & bake gates on the previewing snapshot + a valid name", () => {
	renderPanel({ session: { draft: caveDraft() } });
	expect(button("Freeze & bake").disabled).toBe(true);
	cleanup();

	const previewing = {
		phase: "previewing" as const,
		spec: { name: "w1", regions: [], connectors: [], startRegion: "cave-1" },
	};
	renderPanel({ session: { draft: caveDraft(), status: previewing } });
	expect(button("Freeze & bake").disabled).toBe(false);
	cleanup();

	const bad = { ...caveDraft(), name: "../escape" };
	renderPanel({ session: { draft: bad, status: previewing } });
	expect(button("Freeze & bake").disabled).toBe(true);
});

test("the make-default checkbox renders checked by default (D-W3-9)", () => {
	renderPanel({ session: { draft: caveDraft() } });
	const box = screen.getByLabelText(
		"Make this the game's world",
	) as HTMLInputElement;
	expect(box.checked).toBe(true);
});

test("Freeze passes the SNAPSHOT spec to bakeWorld with the draft name", () => {
	const spec = {
		name: "w1",
		regions: [],
		connectors: [],
		startRegion: "cave-1",
	};
	const { client } = renderPanel({
		session: { draft: caveDraft(), status: { phase: "previewing", spec } },
	});
	fireEvent.click(button("Freeze & bake"));
	expect(client.bakeWorld).toHaveBeenCalled();
	expect(client.bakeWorld.mock.calls[0]?.[0]).toBe(spec);
	expect(client.bakeWorld.mock.calls[0]?.[1]).toBe("w1");
});

test("Freeze uploads the world files cleanDir'd, THEN the index write — and counts only the world's files", async () => {
	// api.generationBake is the panel's one FS crossing — spy it rather than run a daemon.
	// Distinct counts per call prove the reported number comes from the WORLD's file set
	// (call 0), not from the worlds/index.json bookkeeping write (call 1).
	const bakeSpy = spyOn(api, "generationBake").mockImplementation(
		async (_files, cleanDir) => ({ files: cleanDir ? 3 : 1 }),
	);
	try {
		const spec = {
			name: "w1",
			regions: [],
			connectors: [],
			startRegion: "cave-1",
		};
		renderPanel({
			session: { draft: caveDraft(), status: { phase: "previewing", spec } },
			client: {
				bakeWorld: mock(
					(
						_spec: unknown,
						_name: string,
						h: { onBaked: (f: { path: string; contents: string }[]) => void },
					) => h.onBaked([{ path: "worlds/w1/manifest.json", contents: "{}" }]),
				),
			},
		});
		fireEvent.click(button("Freeze & bake"));

		await waitFor(() =>
			expect(
				screen.getByText("baked 3 files — now the game's world"),
			).toBeTruthy(),
		);
		expect(bakeSpy).toHaveBeenCalledTimes(2);

		const [worldFiles, worldClean] = bakeSpy.mock.calls[0] ?? [];
		expect(worldClean).toBe("worlds/w1");
		expect(worldFiles?.[0]?.path).toBe("worlds/w1/manifest.json");

		const [indexFiles, indexClean] = bakeSpy.mock.calls[1] ?? [];
		// index.json lives OUTSIDE the world dir — cleaning to it would be a path violation.
		expect(indexClean).toBeUndefined();
		expect(indexFiles?.[0]?.path).toBe("worlds/index.json");
	} finally {
		bakeSpy.mockRestore();
	}
});

test("a draft the model refuses fails LOUD: destructive, assertive, carrying the reason", () => {
	const { client } = renderPanel({
		session: { draft: doubleClaimedPortalDraft() },
	});
	fireEvent.click(button("Generate"));
	// draftToSpec threw, so the run never reached the worker at all.
	expect(client.runWorld).not.toHaveBeenCalled();
	const line = screen.getByText(/^failed:/);
	expect(line.textContent).toContain("used twice");
	// Not a grey status hint — the preview canvas is blank behind this.
	expect(line.getAttribute("aria-live")).toBe("assertive");
	expect(line.className).toContain("text-destructive");
});

test("a grid child under a cave parent has no legal connector — Add is disabled", () => {
	// legalKinds() is EMPTY for cave -> grid (a grid child can never hang off a cave), so
	// the form refuses the pair UP FRONT. The panel's error line under Add is the backstop
	// for anything the gating misses — addRegion's throw is never swallowed.
	renderPanel({ session: { draft: caveDraft() } });
	// The form opens on "hall" — under the cave anchor that pair has no connector.
	expect(button("Add region").disabled).toBe(true);
	fireEvent.change(screen.getByLabelText("algorithm"), {
		target: { value: "cave" },
	});
	expect(button("Add region").disabled).toBe(false); // cave -> cave: organic-tunnel
});

test("removing the region the Add form had selected as parent leaves the form usable", () => {
	// `parentId` is form-local state that OUTLIVES the draft: without the fallback, removing
	// the selected parent strands the form (blank select, no legal kinds, Add disabled with
	// no stated reason).
	let d = caveDraft();
	d = addRegion(d, {
		id: "cave-2",
		algorithm: "cave",
		knobs: { mouths: 1 },
		seed: "cave-2",
		attachment: {
			kind: "organic-tunnel",
			parentId: "cave-1",
			parentPortal: { mouth: 0 },
			childPortal: { mouth: 0 },
		},
	});
	renderPanel({ session: { draft: d } });

	const attachTo = screen.getByLabelText("attach to") as HTMLSelectElement;
	fireEvent.change(attachTo, { target: { value: "cave-2" } });
	expect(attachTo.value).toBe("cave-2");

	// cave-2 is the leaf, so it is the removable one (row order = draft order).
	const removes = screen.getAllByRole("button", { name: "Remove" });
	fireEvent.click(removes[1] as HTMLButtonElement);

	// The form fell back to the surviving region instead of going blank and dead.
	expect((screen.getByLabelText("attach to") as HTMLSelectElement).value).toBe(
		"cave-1",
	);
	fireEvent.change(screen.getByLabelText("algorithm"), {
		target: { value: "cave" },
	});
	expect(button("Add region").disabled).toBe(false);
});
