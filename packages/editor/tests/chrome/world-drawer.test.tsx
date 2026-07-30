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
import { CatalogProvider } from "../../src/frontend/hooks/useCatalogs.tsx";
import { FieldHostStateProvider } from "../../src/frontend/hooks/useFieldHostState.tsx";
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
import { makeStubHost } from "./_stub-host.ts";

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

/** Serve `/api/*` from `worlds`, record every command, and 404 the catalog GETs. */
function stubDaemon(worlds: WorldRow[], opts: { bakeFiles?: number } = {}) {
	const posted: Posted[] = [];
	globalThis.fetch = mock((input: unknown, init?: RequestInit) => {
		const url = String(input);
		if (!url.startsWith("/api/"))
			return Promise.resolve(new Response("", { status: 404 }));
		const command = url.slice("/api/".length);
		posted.push({
			command,
			input: JSON.parse(String(init?.body ?? "null")) as unknown,
		});
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
	};
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
			<WorldProvider>
				<CatalogProvider>
					<WorkspaceProvider store={undefined}>
						<TopBar />
					</WorkspaceProvider>
				</CatalogProvider>
			</WorldProvider>
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

/** Summon the drawer from the chip and wait for its first listing. */
async function openDrawer(): Promise<HTMLElement> {
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: /untitled|world/ }));
	});
	return await waitFor(() => screen.getByRole("dialog"));
}

const rowFor = (drawer: HTMLElement, name: string): HTMLElement => {
	const item = within(drawer)
		.getAllByRole("listitem")
		.find((li) => within(li).queryByText(name) !== null);
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
	expect(within(drawer).getAllByRole("listitem").length).toBe(3);

	act(() => {
		fireEvent.change(within(drawer).getByLabelText("filter worlds"), {
			target: { value: "grot" },
		});
	});
	expect(within(drawer).getAllByRole("listitem").length).toBe(1);

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
		stub.fire.stats({
			chunks: 0,
			lastRemeshMs: 0,
			remeshVersion: 0,
			totalOps: 0,
			liveGenerators: 0,
			compactableOps: 0,
			undoDepth: 0,
			lastReconfigureMs: 0,
			analyzerPending: 0,
		});
	});
	expect(screen.getByRole("button", { name: "untitled" })).toBeTruthy();

	// …and a change to it is an edit.
	act(() => {
		stub.fire.stats({
			chunks: 1,
			lastRemeshMs: 2,
			remeshVersion: 1,
			totalOps: 1,
			liveGenerators: 0,
			compactableOps: 0,
			undoDepth: 1,
			lastReconfigureMs: 0,
			analyzerPending: 0,
		});
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
