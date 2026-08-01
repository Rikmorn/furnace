// Registered FIRST, before any other import in this file, and that ordering is
// load-bearing rather than style: Radix resolves `globalThis.document` at MODULE
// EVALUATION time to decide whether it may use layout effects, and its Portal never
// mounts if the answer was no. The drawer IS a portal (a Dialog) and every row carries
// a portaled dropdown, so importing it before the DOM exists leaves this whole file
// asserting about an empty document.
import "../inspector/_register.ts";

// The world drawer + the flows around it (D-20/D-21). What is pinned here is the part a
// user can be hurt by: which world the game loads, which rows can be opened at all, and
// that no destructive verb reaches the daemon without a confirm that names what it
// rewrites. The call sequences behind those verbs live in tests/world-actions.test.ts.
import { afterEach, expect, mock, test } from "bun:test";
import type { ConfirmRequest } from "../../src/frontend/components/ConfirmDialog.tsx";
import { TopBar } from "../../src/frontend/components/shell/TopBar.tsx";
import { ActionContextProvider } from "../../src/frontend/hooks/useActionContext.tsx";
import { CatalogProvider } from "../../src/frontend/hooks/useCatalogs.tsx";
import { FieldHostStateProvider } from "../../src/frontend/hooks/useFieldHostState.tsx";
import { ViewProvider } from "../../src/frontend/hooks/useView.tsx";
import { WorkspaceProvider } from "../../src/frontend/hooks/useWorkspace.tsx";
import { WorldProvider } from "../../src/frontend/hooks/useWorld.tsx";
import type { WorldRow } from "../../src/frontend/lib/api.ts";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import {
	act,
	cleanup,
	fireEvent,
	makeEditorContext,
	renderWithEditor,
	screen,
	waitFor,
	within,
} from "../inspector/_harness.tsx";
import { makeStats, makeStubHost } from "./_stub-host.ts";

afterEach(cleanup);
afterEach(() => notify.clear());

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

// --- the daemon, stubbed at the fetch boundary --------------------------------
//
// Stubbed HERE rather than by mocking the api module: `api.ts` is the contract under
// test as much as the drawer is (which command each verb posts, with which body), and a
// module mock would replace exactly that.

type Posted = { command: string; input: unknown };

const row = (over: Partial<WorldRow> = {}): WorldRow => ({
	name: "cavern",
	kind: "field",
	isDefault: false,
	tracked: null,
	manifestMtimeMs: Date.now(),
	...over,
});

/** Serve `/api/*` from `worlds`, record every command, and 404 the catalog GETs.
 *  `hangBakeAfter` leaves the Nth `generation.bake` (0-based) unresolved, which is how a
 *  case gets the editor to sit in its `busy` state for as long as it needs to. */
function stubDaemon(
	worlds: WorldRow[],
	opts: { bakeFiles?: number; hangBakeAfter?: number } = {},
) {
	const posted: Posted[] = [];
	const held: ((r: Response) => void)[] = [];
	let bakes = 0;
	globalThis.fetch = mock((input: unknown, init?: RequestInit) => {
		const url = String(input);
		if (!url.startsWith("/api/"))
			return Promise.resolve(new Response("", { status: 404 }));
		const command = url.slice("/api/".length);
		posted.push({
			command,
			input: JSON.parse(String(init?.body ?? "null")) as unknown,
		});
		if (command === "generation.bake") {
			const nth = bakes++;
			if (opts.hangBakeAfter !== undefined && nth >= opts.hangBakeAfter)
				// Held, not dropped: `releaseBakes()` lets a case run assertions WHILE the
				// write is in flight and then watch what landing does.
				return new Promise<Response>((res) => held.push(res));
		}
		const body =
			command === "world.list"
				? {
						defaultName: worlds.find((w) => w.isDefault)?.name ?? null,
						worlds,
					}
				: command === "generation.bake"
					? { files: opts.bakeFiles ?? 3 }
					: {};
		return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
	}) as unknown as typeof fetch;
	return {
		posted,
		commands: () => posted.map((p) => p.command),
		inputFor: (command: string) =>
			posted.find((p) => p.command === command)?.input,
		/** Settle every held `generation.bake`. */
		releaseBakes: () => {
			for (const settle of held.splice(0))
				settle(
					new Response(JSON.stringify({ files: opts.bakeFiles ?? 3 }), {
						status: 200,
					}),
				);
		},
	};
}

/** Seed the dirty-bit baseline, then move it: the FIRST push is the count the world
 *  already had (never an edit — that is the whole point of the re-seed), the second is
 *  one op of divergence from it. */
function makeDirty(stub: ReturnType<typeof makeStubHost>, ops = 1): void {
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 0 }));
	});
	act(() => {
		stub.fire.stats(makeStats({ totalOps: ops, undoDepth: ops }));
	});
}

/** Open the burger and return one of its items by exact label. Awaited rather than read
 *  synchronously: the menu content is a PORTAL behind Radix's Presence, and when the
 *  drawer has just closed (its own exit transition still settling) the mount lands a
 *  turn later than the pointerdown. */
async function burgerItem(label: string): Promise<HTMLElement> {
	act(() => {
		fireEvent.pointerDown(screen.getByLabelText("editor menu"), {
			button: 0,
			pointerType: "mouse",
		});
	});
	return await waitFor(() => screen.getByText(label));
}

// --- mounting -----------------------------------------------------------------

/** The top bar (chip + drawer) under the provider stack the shell gives it. The bar
 *  rather than the drawer alone: the chip is how a drawer is summoned, and a drawer
 *  nothing can open is not the thing being tested. */
async function renderTopBar(
	stub: ReturnType<typeof makeStubHost>,
	overrides: { openConfirm?: (r: ConfirmRequest) => void } = {},
) {
	const result = renderWithEditor(
		<FieldHostStateProvider host={stub.host} engineReady>
			{/* The bar's View popover and the burger's view items read this — the real shell
			    mounts it one level above the world state, and so does this. */}
			<ViewProvider host={stub.host} engineReady store={undefined}>
				{/* Above the world state, exactly as the shell mounts it: the boot restore
				    waits for the materials settle this provider owns. */}
				<CatalogProvider>
					<WorldProvider>
						<WorkspaceProvider store={undefined}>
							{/* The burger's groups and the shortcut overlay are rendered FROM the
							    action registry, so the bar needs the context that assembles it —
							    innermost, exactly as the shell mounts it. */}
							<ActionContextProvider host={stub.host}>
								<TopBar />
							</ActionContextProvider>
						</WorkspaceProvider>
					</WorldProvider>
				</CatalogProvider>
			</ViewProvider>
		</FieldHostStateProvider>,
		makeEditorContext({
			fieldHostRef: { current: stub.host },
			...(overrides.openConfirm ? { openConfirm: overrides.openConfirm } : {}),
		}),
	);
	// Let the catalog pass settle (fetch → res.text), or every Open stays gated.
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	return result;
}

/** Dismiss the drawer and wait for it to go. Needed before asserting on the chip: the
 *  drawer is MODAL, so everything behind it is `aria-hidden` and invisible to a role
 *  query — which is correct behaviour, and exactly what a test has to respect. */
async function dismissDrawer(): Promise<void> {
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
	});
	await waitFor(() => expect(screen.queryByRole("dialog") === null).toBe(true));
}

/** Summon the drawer from the world chip and wait for it. The chip's accessible name IS
 *  the world's name (that is the point of the chip), so a case that has already named its
 *  world passes it in. */
async function openDrawer(
	chip: string | RegExp = /^untitled/,
): Promise<HTMLElement> {
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: chip }));
	});
	return await waitFor(() => screen.getByRole("dialog"));
}

/** One world's row. The rows are `option`s inside a `listbox`, not list items: the
 *  drawer carries a keyboard cursor, and `aria-selected` is what makes that cursor exist
 *  for anything but the eye. */
const rowFor = (drawer: HTMLElement, name: string): HTMLElement => {
	const item = within(drawer)
		.getAllByRole("option")
		.find((row) => within(row).queryByText(name) !== null);
	if (!item) throw new Error(`no row for "${name}"`);
	return item;
};

/** Open a row's ⋯ menu. Radix opens on pointerdown, not click. */
function openRowMenu(drawer: HTMLElement, name: string): void {
	act(() => {
		fireEvent.pointerDown(
			within(rowFor(drawer, name)).getByLabelText(`more actions for ${name}`),
			{ button: 0, pointerType: "mouse" },
		);
	});
}

// --- (a) the rows say what the worlds ARE -------------------------------------

test("every badge kind renders, and an INDETERMINATE tracked flag renders none", async () => {
	stubDaemon([
		row({ name: "default", isDefault: true, tracked: true }),
		row({ name: "mine-01", tracked: false }),
		row({ name: "old-cave", kind: "legacy", tracked: null }),
	]);
	const stub = makeStubHost();
	await renderTopBar(stub);
	const drawer = await openDrawer();
	await waitFor(() => rowFor(drawer, "default"));

	// The one badge that answers "what does the game load?" — the question the drawer
	// exists for.
	expect(
		within(rowFor(drawer, "default")).getByText("▶ game loads this"),
	).toBeTruthy();
	expect(within(rowFor(drawer, "default")).getByText("tracked")).toBeTruthy();
	expect(within(rowFor(drawer, "mine-01")).getByText("scratch")).toBeTruthy();
	expect(within(rowFor(drawer, "old-cave")).getByText("legacy")).toBeTruthy();

	// tracked === null is INDETERMINATE (no git repo, or an ambiguous answer). Rendering
	// either badge there would be a guess presented as a fact — the exact thing the
	// tri-state exists to prevent.
	//
	// Asserted on the row's TEXT rather than with `queryByText(...).toBeNull()`: a
	// happy-dom element carries React's fiber graph, so a failing null-check serialises
	// tens of megabytes and reads as a hung run instead of a failed assertion (the
	// house lesson from the palette suite).
	const indeterminate = rowFor(drawer, "old-cave").textContent ?? "";
	expect(indeterminate).not.toContain("tracked");
	expect(indeterminate).not.toContain("scratch");
});

test("a legacy world cannot be opened, and the row says why", async () => {
	stubDaemon([
		row({ name: "old-cave", kind: "legacy" }),
		row({ name: "cavern" }),
	]);
	const stub = makeStubHost();
	await renderTopBar(stub);
	const drawer = await openDrawer();
	await waitFor(() => rowFor(drawer, "old-cave"));

	// `field.load` only speaks v2 (a world with an oplog). A v1 directory would fail
	// somewhere in the daemon with a message about a missing file; refusing here, with
	// the reason IN the accessible name, is the difference between a rule and a crash.
	const legacy = within(rowFor(drawer, "old-cave")).getByRole("button", {
		name: /^open old-cave/,
	}) as HTMLButtonElement;
	expect(legacy.disabled).toBe(true);
	expect(legacy.getAttribute("aria-label")).toContain("no oplog");

	const modern = within(rowFor(drawer, "cavern")).getByRole("button", {
		name: /^open cavern/,
	}) as HTMLButtonElement;
	expect(modern.disabled).toBe(false);
});

test("the filter narrows the list, and ⏎ opens what is selected", async () => {
	const daemon = stubDaemon([
		row({ name: "cavern" }),
		row({ name: "grotto" }),
		row({ name: "mine-01" }),
	]);
	const stub = makeStubHost();
	await renderTopBar(stub);
	const drawer = await openDrawer();
	await waitFor(() => rowFor(drawer, "cavern"));
	expect(within(drawer).getAllByRole("option").length).toBe(3);

	act(() => {
		fireEvent.change(within(drawer).getByLabelText("filter worlds"), {
			target: { value: "grot" },
		});
	});
	expect(within(drawer).getAllByRole("option").length).toBe(1);

	await act(async () => {
		fireEvent.keyDown(drawer, { key: "Enter" });
		await Promise.resolve();
		await Promise.resolve();
	});
	// The FILTERED selection, not the first row of the unfiltered list — typing to find
	// a world and pressing return has to open the one that is on screen.
	expect(daemon.inputFor("field.load")).toEqual({ name: "grotto" });
});

test("Open waits for the materials catalog, and the row says why", async () => {
	// The gate that used to sit on the field toolbar's Load button. A v2 world remeshes
	// against the material table it was baked with, so opening one before the catalog
	// has settled resolves its classes against the rock-only fallback — a world that
	// silently comes back grey. ONLY the materials GET hangs; everything else answers.
	let settle!: (r: Response) => void;
	const pending = new Promise<Response>((res) => {
		settle = res;
	});
	globalThis.fetch = mock((input: unknown) => {
		const url = String(input);
		if (url.includes("materials.json")) return pending;
		if (url === "/api/world.list")
			return Promise.resolve(
				new Response(
					JSON.stringify({
						defaultName: null,
						worlds: [row({ name: "cavern" })],
					}),
					{ status: 200 },
				),
			);
		return Promise.resolve(new Response("", { status: 404 }));
	}) as unknown as typeof fetch;

	const stub = makeStubHost();
	await renderTopBar(stub);
	const drawer = await openDrawer();
	await waitFor(() => rowFor(drawer, "cavern"));
	const open = within(rowFor(drawer, "cavern")).getByRole("button", {
		name: /^open cavern/,
	}) as HTMLButtonElement;
	expect(open.disabled).toBe(true);
	expect(open.getAttribute("aria-label")).toContain("materials catalog");

	// The async scope is the point: act() drains the microtask queue the settled fetch
	// schedules; the callback body has nothing of its own to await.
	// biome-ignore lint/suspicious/useAwait: intentionally await-free async act scope
	await act(async () => {
		settle(new Response("", { status: 404 }));
	});
	// EVERY outcome settles the gate, 404 included — Load must never wedge shut on a
	// project that simply has no catalog.
	await waitFor(() =>
		expect(
			(
				within(rowFor(drawer, "cavern")).getByRole("button", {
					name: /^open cavern/,
				}) as HTMLButtonElement
			).disabled,
		).toBe(false),
	);
});

// --- (b) the destructive verbs go through a confirm that names the file --------

test("Make default confirms, naming worlds/index.json, before anything is rewritten", async () => {
	const daemon = stubDaemon([
		row({ name: "default", isDefault: true }),
		row({ name: "cavern" }),
	]);
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	await renderTopBar(stub, {
		openConfirm: (r) => {
			request = r;
		},
	});
	const drawer = await openDrawer();
	await waitFor(() => rowFor(drawer, "cavern"));

	openRowMenu(drawer, "cavern");
	act(() => {
		fireEvent.click(screen.getByText("Make default"));
	});

	// The prompt exists, and it names the FILE it rewrites — "make default" alone does
	// not tell anyone that a tracked file in their repo is about to change.
	const prompt = request as ConfirmRequest | null;
	if (!prompt) throw new Error("make default did not confirm");
	expect(prompt.message).toContain("worlds/index.json");
	expect(prompt.message).toContain("cavern");
	// …and NOTHING has been written yet.
	expect(daemon.commands()).not.toContain("world.makeDefault");

	await act(async () => {
		prompt.onConfirm();
		await Promise.resolve();
	});
	expect(daemon.inputFor("world.makeDefault")).toEqual({ name: "cavern" });
});

test("the burger's Make default points the game at the OPEN world, without writing over it", async () => {
	const daemon = stubDaemon([]);
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	await renderTopBar(stub, {
		openConfirm: (r) => {
			request = r;
		},
	});

	// Untitled: there is no directory for the game to load, so the item carries the reason
	// IN its label — a disabled item swallows the tooltip that would otherwise say it
	// (the Bake precedent, one row above it).
	const untitled = await burgerItem("Make default — name the world first");
	expect(untitled.getAttribute("aria-disabled")).toBe("true");
	act(() => {
		fireEvent.keyDown(document.activeElement ?? document.body, {
			key: "Escape",
		});
	});

	// Name it the way a user does, then use the menu item rather than the drawer row: the
	// world already open is exactly the case that otherwise costs a trip through the list.
	const drawer = await openDrawer();
	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save as…" }));
	});
	act(() => {
		fireEvent.change(within(drawer).getByLabelText("save as world name"), {
			target: { value: "cavern" },
		});
	});
	await act(async () => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
	await waitFor(() => screen.getByRole("button", { name: "cavern" }));

	const item = await burgerItem("Make default");
	act(() => {
		fireEvent.click(item);
	});
	const prompt = request as ConfirmRequest | null;
	if (!prompt) throw new Error("make default did not confirm");
	expect(prompt.message).toContain("worlds/index.json");
	expect(prompt.message).toContain("cavern");

	await act(async () => {
		prompt.onConfirm();
		await Promise.resolve();
	});
	expect(daemon.inputFor("world.makeDefault")).toEqual({ name: "cavern" });
	// …and it wrote NOTHING else on the way. That is the whole difference from Bake, which
	// rewrites worlds/cavern/** with the session first: this verb repoints the game at the
	// saved copy and leaves it exactly as it is.
	expect(daemon.commands().filter((c) => c === "generation.bake").length).toBe(
		1, // the save-as above, and nothing since
	);
});

test("Rename takes its name from an inline form — and Esc cancels the FORM, not the drawer", async () => {
	const daemon = stubDaemon([row({ name: "cavern" })]);
	const stub = makeStubHost();
	await renderTopBar(stub);
	const drawer = await openDrawer();
	await waitFor(() => rowFor(drawer, "cavern"));

	openRowMenu(drawer, "cavern");
	act(() => {
		fireEvent.click(screen.getByText("Rename…"));
	});
	const field = within(drawer).getByLabelText("rename cavern to");
	// Prefilled with the current name: a rename is usually an edit of it, not a
	// retype.
	expect((field as HTMLInputElement).value).toBe("cavern");

	// Escape belongs to the FORM while one is open. Without the form stopping the
	// event, the drawer's own dismiss takes it and the whole list disappears — a
	// keystroke that costs a mis-typed rename AND the place it was being typed.
	act(() => {
		fireEvent.keyDown(field, { key: "Escape" });
	});
	expect(screen.getByRole("dialog")).toBeTruthy();
	expect(within(drawer).queryByLabelText("rename cavern to") === null).toBe(
		true,
	);

	openRowMenu(drawer, "cavern");
	act(() => {
		fireEvent.click(screen.getByText("Rename…"));
	});
	act(() => {
		fireEvent.change(within(drawer).getByLabelText("rename cavern to"), {
			target: { value: "grotto" },
		});
	});
	await act(async () => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Rename" }));
		await Promise.resolve();
		await Promise.resolve();
	});
	expect(daemon.inputFor("world.rename")).toEqual({
		from: "cavern",
		to: "grotto",
	});
});

test("the default world's Delete is disabled, with the way out in its label", async () => {
	stubDaemon([
		row({ name: "default", isDefault: true }),
		row({ name: "cavern" }),
	]);
	const stub = makeStubHost();
	await renderTopBar(stub);
	const drawer = await openDrawer();
	await waitFor(() => rowFor(drawer, "default"));

	openRowMenu(drawer, "default");
	// The daemon refuses this too — saying so HERE turns a surprise error toast into a
	// control that explains itself, and the label carries the FIX rather than only the
	// refusal.
	const item = screen.getByText("Delete — make another world default first");
	expect(item.getAttribute("aria-disabled")).toBe("true");
});

test("Delete on a non-default row confirms before it reaches the daemon", async () => {
	const daemon = stubDaemon([
		row({ name: "default", isDefault: true }),
		row({ name: "cavern" }),
	]);
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	await renderTopBar(stub, {
		openConfirm: (r) => {
			request = r;
		},
	});
	const drawer = await openDrawer();
	await waitFor(() => rowFor(drawer, "cavern"));

	openRowMenu(drawer, "cavern");
	act(() => {
		fireEvent.click(screen.getByText("Delete"));
	});
	const prompt = request as ConfirmRequest | null;
	if (!prompt) throw new Error("delete did not confirm");
	expect(prompt.destructive).toBe(true);
	expect(prompt.message).toContain("worlds/cavern/");
	expect(daemon.commands()).not.toContain("world.delete");

	await act(async () => {
		prompt.onConfirm();
		await Promise.resolve();
	});
	expect(daemon.inputFor("world.delete")).toEqual({ name: "cavern" });
});

// --- (c) the tracked-overwrite guard, end to end ------------------------------

test("saving over a TRACKED world routes through a confirm that names the files", async () => {
	const daemon = stubDaemon([row({ name: "cavern", tracked: true })]);
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	await renderTopBar(stub, {
		openConfirm: (r) => {
			request = r;
		},
	});
	const drawer = await openDrawer();
	await waitFor(() => rowFor(drawer, "cavern"));

	// Save-as onto the tracked name — the shape of the clobber this guard exists for
	// (the incident that put it in the spec happened twice).
	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save as…" }));
	});
	act(() => {
		fireEvent.change(within(drawer).getByLabelText("save as world name"), {
			target: { value: "cavern" },
		});
	});
	await act(async () => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
		await Promise.resolve();
		await Promise.resolve();
	});

	const prompt = request as ConfirmRequest | null;
	if (!prompt) throw new Error("the tracked save did not confirm");
	expect(prompt.destructive).toBe(true);
	expect(prompt.message).toContain("worlds/cavern/**");
	// Nothing written. The guard is only worth anything if it stands BEFORE the upload.
	expect(daemon.commands()).not.toContain("generation.bake");

	await act(async () => {
		prompt.onConfirm();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
	await waitFor(() => expect(daemon.commands()).toContain("generation.bake"));
});

// --- (d) the chip is the world's readout --------------------------------------

test("the chip reads untitled until a save names the world, and marks unsaved edits", async () => {
	stubDaemon([]);
	const stub = makeStubHost();
	await renderTopBar(stub);
	// Never prefilled: a stale default is what silently overwrote the game's world
	// twice (the W3/W4 clobber lesson).
	expect(screen.getByRole("button", { name: "untitled" })).toBeTruthy();

	// The first stats push SEEDS the baseline — it is the count the world already had,
	// not an edit.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 0 }));
	});
	expect(screen.getByRole("button", { name: "untitled" })).toBeTruthy();

	// …and a change to it is an edit.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 1, undoDepth: 1 }));
	});
	expect(
		screen.getByRole("button", { name: "untitled — unsaved changes" }),
	).toBeTruthy();
});

test("Bake is refused while the world is untitled, and live once it is named", async () => {
	const daemon = stubDaemon([]);
	const stub = makeStubHost();
	await renderTopBar(stub);
	// Bake writes worlds/index.json as well as the world, so it needs a name to write
	// about. Disabled rather than silently doing a save-as: the two verbs commit to
	// different things.
	expect(
		(screen.getByRole("button", { name: "Bake" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);

	const drawer = await openDrawer();
	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save as…" }));
	});
	act(() => {
		fireEvent.change(within(drawer).getByLabelText("save as world name"), {
			target: { value: "cavern" },
		});
	});
	await act(async () => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});

	// The save named the session's world, so the chip and Bake both follow it.
	await waitFor(() => screen.getByRole("button", { name: "cavern" }));
	expect(
		(screen.getByRole("button", { name: "Bake" }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
	expect(daemon.inputFor("generation.bake")).toMatchObject({
		cleanDir: "worlds/cavern",
	});
});

test("a save reports its OUTCOME, and says nothing while it is in flight", async () => {
	// The stack caps at 3 and NEVER evicts, so a "saving…" toast in front of the
	// outcome is a slot spent on something that has already finished. In-flight is said
	// AT the controls (they disable); D-19's mechanism for a long job is a progress chip
	// with a cooperative cancel (F4.5c), not a toast nobody can act on.
	stubDaemon([], { bakeFiles: 12 });
	const stub = makeStubHost();
	await renderTopBar(stub);
	const drawer = await openDrawer();
	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save as…" }));
	});
	act(() => {
		fireEvent.change(within(drawer).getByLabelText("save as world name"), {
			target: { value: "cavern" },
		});
	});
	await act(async () => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});

	await waitFor(() =>
		expect(notify.getSnapshot().log.map((m) => m.text)).toContain(
			"saved 12 files → worlds/cavern",
		),
	);
	expect(notify.getSnapshot().log.some((m) => /saving/.test(m.text))).toBe(
		false,
	);
});

test("a name that breaks the rule cannot be submitted, and the rule is on screen", async () => {
	stubDaemon([]);
	const stub = makeStubHost();
	await renderTopBar(stub);
	const drawer = await openDrawer();
	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save as…" }));
	});
	const field = within(drawer).getByLabelText("save as world name");
	// STATED, not revealed by failing it (D-21).
	expect(
		within(drawer).getByText(
			"letters, digits, - and _ — starting with a letter or digit",
		),
	).toBeTruthy();

	act(() => {
		fireEvent.change(field, { target: { value: "../etc" } });
	});
	expect(
		(within(drawer).getByRole("button", { name: "Save" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(field.getAttribute("aria-invalid")).toBe("true");
});

// --- (e) New world -------------------------------------------------------------

test("New world resets the host and takes the session back to untitled", async () => {
	stubDaemon([row({ name: "cavern" })]);
	const stub = makeStubHost();
	await renderTopBar(stub);
	const drawer = await openDrawer();
	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "New world" }));
	});
	expect(stub.calls.newWorld.mock.calls.length).toBe(1);
	// The drawer closes with it: the list was the way to pick a world, and the world
	// has been picked.
	await waitFor(() => expect(screen.queryByRole("dialog") === null).toBe(true));
	expect(screen.getByRole("button", { name: "untitled" })).toBeTruthy();
});

// --- (f) the discard gate: nothing unsaved is thrown away silently -------------
//
// Charter §7's confirm-destructive rule, made cheap by the dirty bit. New and Open are
// the only two world verbs that DESTROY: they replace the host's world outright and the
// op log — the editor's only undo — goes with it. A save writes the work down; a
// rename/duplicate/delete moves other directories around.

test("New on a DIRTY session confirms first, naming how much is lost", async () => {
	stubDaemon([]);
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	await renderTopBar(stub, {
		openConfirm: (r) => {
			request = r;
		},
	});
	makeDirty(stub, 3);
	const drawer = await openDrawer();

	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "New world" }));
	});
	const prompt = request as ConfirmRequest | null;
	if (!prompt) throw new Error("New did not confirm on a dirty session");
	expect(prompt.destructive).toBe(true);
	// The NUMBER is the point: "you have unsaved changes" is a sentence people click
	// through, "3 unsaved ops" is one they weigh.
	expect(prompt.message).toContain("3 unsaved ops");
	expect(prompt.message).toContain("undo history");
	// …and nothing has happened yet. A confirm that fires AFTER the host is emptied is
	// decoration.
	expect(stub.calls.newWorld).not.toHaveBeenCalled();
});

test("cancelling the discard keeps the session, the drawer and the dirty mark", async () => {
	stubDaemon([]);
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	await renderTopBar(stub, {
		openConfirm: (r) => {
			request = r;
		},
	});
	makeDirty(stub);
	const drawer = await openDrawer();
	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "New world" }));
	});
	const prompt = request as ConfirmRequest | null;
	if (!prompt) throw new Error("New did not confirm on a dirty session");

	// Cancel is the whole reason the prompt exists: it has to leave EVERYTHING as it was.
	act(() => {
		prompt.onCancel?.();
	});
	expect(stub.calls.newWorld).not.toHaveBeenCalled();
	expect(screen.getByRole("dialog")).toBeTruthy();

	// …and confirming still works, so the gate is a gate and not a wall.
	act(() => {
		prompt.onConfirm();
	});
	expect(stub.calls.newWorld.mock.calls.length).toBe(1);
});

test("New on a CLEAN session confirms nothing", async () => {
	stubDaemon([]);
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	await renderTopBar(stub, {
		openConfirm: (r) => {
			request = r;
		},
	});
	// Seed the baseline and stop — no divergence, nothing to lose.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 4 }));
	});
	const drawer = await openDrawer();
	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "New world" }));
	});
	// A prompt on every New is one people learn to dismiss without reading — which is
	// how the prompts that DO matter stop working.
	expect(request === null).toBe(true);
	expect(stub.calls.newWorld.mock.calls.length).toBe(1);
});

test("Open on a DIRTY session confirms before it replaces the world", async () => {
	const daemon = stubDaemon([row({ name: "cavern" })]);
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	await renderTopBar(stub, {
		openConfirm: (r) => {
			request = r;
		},
	});
	makeDirty(stub, 2);
	const drawer = await openDrawer();
	await waitFor(() => rowFor(drawer, "cavern"));

	await act(async () => {
		fireEvent.click(
			within(rowFor(drawer, "cavern")).getByRole("button", {
				name: /^open cavern/,
			}),
		);
		await Promise.resolve();
	});
	const prompt = request as ConfirmRequest | null;
	if (!prompt) throw new Error("Open did not confirm on a dirty session");
	expect(prompt.title).toContain("cavern");
	expect(prompt.message).toContain("2 unsaved ops");
	// The load has NOT started — the guard stands in front of the daemon call, not
	// beside it.
	expect(daemon.commands()).not.toContain("field.load");

	await act(async () => {
		prompt.onConfirm();
		await Promise.resolve();
		await Promise.resolve();
	});
	expect(daemon.inputFor("field.load")).toEqual({ name: "cavern" });
});

test("a SAVE clears the discard gate — the work is on disk, so New asks nothing", async () => {
	stubDaemon([]);
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	await renderTopBar(stub, {
		openConfirm: (r) => {
			request = r;
		},
	});
	makeDirty(stub, 5);
	const drawer = await openDrawer();
	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save as…" }));
	});
	act(() => {
		fireEvent.change(within(drawer).getByLabelText("save as world name"), {
			target: { value: "cavern" },
		});
	});
	await act(async () => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
	await waitFor(() => screen.getByRole("button", { name: "cavern" }));

	// The save moved the save point to where the session already is. Without that, every
	// New after a save would still prompt about ops that are safely on disk.
	const newItem = await burgerItem("New");
	act(() => {
		fireEvent.click(newItem);
	});
	expect(request === null).toBe(true);
	expect(stub.calls.newWorld.mock.calls.length).toBe(1);
});

// --- (g) New is busy-gated on BOTH surfaces ------------------------------------

test("the burger's New is disabled while a write is in flight", async () => {
	// The narrow data-loss path this closes: New empties the host SYNCHRONOUSLY, while an
	// in-flight save sits between `exportArtifact` and its uploads. Ungated, a New landing
	// mid-save writes the freshly-emptied world over the named target.
	stubDaemon([], { hangBakeAfter: 1 });
	const stub = makeStubHost();
	await renderTopBar(stub);
	const drawer = await openDrawer();
	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save as…" }));
	});
	act(() => {
		fireEvent.change(within(drawer).getByLabelText("save as world name"), {
			target: { value: "cavern" },
		});
	});
	await act(async () => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
	await waitFor(() => screen.getByRole("button", { name: "cavern" }));

	// Not disabled yet: nothing is in flight.
	expect((await burgerItem("New")).getAttribute("aria-disabled")).not.toBe(
		"true",
	);
	act(() => {
		fireEvent.keyDown(document.activeElement ?? document.body, {
			key: "Escape",
		});
	});

	// Now start a Bake whose upload never settles.
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Bake" }));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
	expect((await burgerItem("New")).getAttribute("aria-disabled")).toBe("true");
});

// --- (h) the save point is what was WRITTEN, not where the session got to -------

test("ops that land DURING the upload stay unsaved — the save point is the snapshot", async () => {
	// The bug this pins, in the order it happens: ⌘S starts, the upload awaits a round
	// trip, the user keeps digging, the upload lands, and the save point is taken from
	// where the session is NOW. Those digs are silently adopted as saved: the chip goes
	// clean, and the discard gate then throws them away without asking — which is the one
	// outcome the whole dirty-bit mechanism exists to prevent.
	const daemon = stubDaemon([], { hangBakeAfter: 0 });
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	await renderTopBar(stub, {
		openConfirm: (r) => {
			request = r;
		},
	});
	makeDirty(stub, 4);

	const drawer = await openDrawer();
	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save as…" }));
	});
	act(() => {
		fireEvent.change(within(drawer).getByLabelText("save as world name"), {
			target: { value: "cavern" },
		});
	});
	await act(async () => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
		await Promise.resolve();
		await Promise.resolve();
	});

	// Two more digs while the upload is in flight — the artifact went out at 4 ops.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 6, undoDepth: 6 }));
	});

	// Release the upload.
	await act(async () => {
		daemon.releaseBakes();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
	await waitFor(() => screen.getByRole("button", { name: /cavern/ }));

	// STILL dirty: two ops exist only in the session. A clean chip here is a lie the user
	// acts on.
	expect(
		screen.getByRole("button", { name: "cavern — unsaved changes" }),
	).toBeTruthy();

	// …and the discard gate agrees, naming exactly the two that are at risk.
	const newItem = await burgerItem("New");
	act(() => {
		fireEvent.click(newItem);
	});
	const prompt = request as ConfirmRequest | null;
	if (!prompt) throw new Error("New did not confirm after a mid-upload edit");
	expect(prompt.message).toContain("2 unsaved ops");
});

// --- (i) the keyboard cursor obeys every gate the buttons do -------------------

test("⏎ obeys the busy gate — it cannot walk past a disabled Open", async () => {
	// Without this, ⏎ reaches `actions.open`, which a write in flight silently refuses.
	// On a dirty session that refusal lands AFTER the discard confirm has been answered
	// yes: the user has agreed to lose the work and then nothing happens.
	const daemon = stubDaemon([row({ name: "cavern" })], { hangBakeAfter: 0 });
	const stub = makeStubHost();
	await renderTopBar(stub);
	const drawer = await openDrawer();
	await waitFor(() => rowFor(drawer, "cavern"));

	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save as…" }));
	});
	act(() => {
		fireEvent.change(within(drawer).getByLabelText("save as world name"), {
			target: { value: "scratch" },
		});
	});
	await act(async () => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
		await Promise.resolve();
		await Promise.resolve();
	});
	// The write is hung — the row's own Open button says so.
	expect(
		(
			within(rowFor(drawer, "cavern")).getByRole("button", {
				name: /^open cavern/,
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);

	await act(async () => {
		fireEvent.keyDown(drawer, { key: "Enter" });
		await Promise.resolve();
	});
	expect(daemon.commands()).not.toContain("field.load");
});

// --- (j) the session follows its own world through rename and delete -----------

test("renaming the OPEN world moves the session with it — the next save writes the NEW name", async () => {
	const daemon = stubDaemon([row({ name: "cavern" })]);
	const stub = makeStubHost();
	await renderTopBar(stub);
	let drawer = await openDrawer();

	// Get the session onto "cavern" the way a user does.
	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save as…" }));
	});
	act(() => {
		fireEvent.change(within(drawer).getByLabelText("save as world name"), {
			target: { value: "cavern" },
		});
	});
	await act(async () => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
	await waitFor(() => screen.getByRole("button", { name: "cavern" }));

	drawer = await openDrawer("cavern");
	await waitFor(() => rowFor(drawer, "cavern"));
	openRowMenu(drawer, "cavern");
	act(() => {
		fireEvent.click(screen.getByText("Rename…"));
	});
	act(() => {
		fireEvent.change(within(drawer).getByLabelText("rename cavern to"), {
			target: { value: "grotto" },
		});
	});
	await act(async () => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Rename" }));
		await Promise.resolve();
		await Promise.resolve();
	});

	// The chip follows…
	await dismissDrawer();
	await waitFor(() => screen.getByRole("button", { name: "grotto" }));
	// …and so does the WRITE, which is the half that matters: a session still pointing at
	// the old name would re-create the directory the rename just emptied.
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: "Bake" }));
	});
	// The WORLD-FILES call (the one carrying a cleanDir) — a bake posts a second,
	// cleanDir-free write for worlds/index.json, and that one says nothing about which
	// directory the session believes it owns.
	await waitFor(() => {
		const dirs = daemon.posted
			.filter((p) => p.command === "generation.bake")
			.map((p) => (p.input as { cleanDir?: string }).cleanDir)
			.filter((d): d is string => d !== undefined);
		expect(dirs.at(-1)).toBe("worlds/grotto");
	});
});

test("deleting the OPEN world leaves the session untitled AND dirty", async () => {
	stubDaemon([row({ name: "cavern" })]);
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	await renderTopBar(stub, {
		openConfirm: (r) => {
			request = r;
		},
	});
	let drawer = await openDrawer();
	act(() => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save as…" }));
	});
	act(() => {
		fireEvent.change(within(drawer).getByLabelText("save as world name"), {
			target: { value: "cavern" },
		});
	});
	await act(async () => {
		fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
	await waitFor(() => screen.getByRole("button", { name: "cavern" }));

	drawer = await openDrawer("cavern");
	await waitFor(() => rowFor(drawer, "cavern"));
	openRowMenu(drawer, "cavern");
	act(() => {
		fireEvent.click(screen.getByText("Delete"));
	});
	await act(async () => {
		(request as ConfirmRequest | null)?.onConfirm();
		await Promise.resolve();
		await Promise.resolve();
	});

	// Untitled — the session keeps every edit, it just has nowhere on disk to go back to.
	// And DIRTY by that same fact: content that exists nowhere on disk is unsaved, whatever
	// the op count says, so the next New has to ask before discarding it.
	await dismissDrawer();
	await waitFor(() =>
		screen.getByRole("button", { name: "untitled — unsaved changes" }),
	);
	request = null;
	const newItem = await burgerItem("New");
	act(() => {
		fireEvent.click(newItem);
	});
	expect(request === null).toBe(false);
});

// --- (k) filter matching is case-insensitive -----------------------------------

test("the filter ignores case on BOTH sides", async () => {
	stubDaemon([row({ name: "Cavern" }), row({ name: "grotto" })]);
	const stub = makeStubHost();
	await renderTopBar(stub);
	const drawer = await openDrawer();
	await waitFor(() => rowFor(drawer, "Cavern"));

	// World names may carry capitals (WORLD_NAME_RE's `i` flag allows them). A filter
	// that hides "Cavern" when you type "cav" reads as a missing world.
	act(() => {
		fireEvent.change(within(drawer).getByLabelText("filter worlds"), {
			target: { value: "CAV" },
		});
	});
	expect(within(drawer).getAllByRole("option").length).toBe(1);
	expect(rowFor(drawer, "Cavern")).toBeTruthy();
});
