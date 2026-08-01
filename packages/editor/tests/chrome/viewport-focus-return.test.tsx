import "../inspector/_register.ts";

// Conditional viewport focus return (F4.5c Task 10, D-F4.5-26 / WCAG 2.4.3): dismissing a
// chrome overlay puts the user back where they were, and "where they were" is the canvas
// ONLY when the canvas is where they came from.
//
// EVERY case here is a PAIR, and the negative half is the one that matters: a mechanism
// that always returns focus to the canvas passes the positive half of every case and IS
// the WCAG violation the conditional exists to avoid. Sabotage-proven both ways — dropping
// the "did the canvas have it" condition reddens every negative half, dropping the
// machinery reddens every positive half and leaves the negatives green (they are Radix's
// own behaviour, which this must compose with rather than replace).
//
// WHAT HAPPY-DOM CAN AND CANNOT PROVE HERE, measured before this file was written rather
// than assumed — focus is the most harness-divergent thing in this package:
//   - it does NOT move focus on a click or a mousedown. The browser step where a clicked
//     trigger takes focus BEFORE the overlay opens is simply absent. That is why every
//     fixture drives the GESTURE explicitly (`pointerDown` for a mouse open, `keyDown` for
//     a keyboard one): the record is taken at gesture start, so the fixture states the
//     thing under test instead of leaning on a harness accident that would make a
//     never-fires-in-a-browser implementation look correct.
//   - it DOES run Radix's FocusScope, both halves. Opening a popover moves focus into the
//     content, and closing it puts focus back on the trigger from the deferred
//     `setTimeout(…, 0)`. So the trigger-restoration assertions below are proving real
//     Radix behaviour, and `dismiss()` waits that macrotask out.
// What is therefore REASONED rather than proven here: that a real browser focuses the
// clicked trigger before `onOpenAutoFocus` runs. Nothing in this file depends on it — the
// gesture record was chosen precisely so it does not — but it is the reason the record is
// not taken at the open edge, and only a browser can demonstrate that.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { useState } from "react";
import { ConfirmDialog } from "../../src/frontend/components/ConfirmDialog.tsx";
import type { ViewportFocus } from "../../src/frontend/components/editor-context.ts";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { Shell } from "../../src/frontend/components/shell/Shell.tsx";
import { ShortcutsDialog } from "../../src/frontend/components/shell/ShortcutsDialog.tsx";
import { ActionContextProvider } from "../../src/frontend/hooks/useActionContext.tsx";
import { CatalogProvider } from "../../src/frontend/hooks/useCatalogs.tsx";
import { FieldHostStateProvider } from "../../src/frontend/hooks/useFieldHostState.tsx";
import { ViewProvider } from "../../src/frontend/hooks/useView.tsx";
import { WorkspaceProvider } from "../../src/frontend/hooks/useWorkspace.tsx";
import { WorldProvider } from "../../src/frontend/hooks/useWorld.tsx";
import type { WorldRow } from "../../src/frontend/lib/api.ts";
import {
	act,
	cleanup,
	fireEvent,
	makeEditorContext,
	render,
	renderWithEditor,
	screen,
	within,
} from "../inspector/_harness.tsx";
import { makeStats, makeStubHost } from "./_stub-host.ts";

afterEach(cleanup);

// CanvasHost measures at mount and throws on a zero box (the shell's CSS contract broken);
// happy-dom lays nothing out, so a case that wants the real canvas has to supply one.
const REAL_RECT = HTMLCanvasElement.prototype.getBoundingClientRect;
const SIZED = { x: 0, y: 0, width: 1280, height: 720 };
beforeEach(() => {
	HTMLCanvasElement.prototype.getBoundingClientRect = () =>
		({
			...SIZED,
			top: 0,
			left: 0,
			right: SIZED.width,
			bottom: SIZED.height,
			toJSON: () => SIZED,
		}) as DOMRect;
});
const realFetch = globalThis.fetch;
afterEach(() => {
	HTMLCanvasElement.prototype.getBoundingClientRect = REAL_RECT;
	globalThis.fetch = realFetch;
});

const world = (name: string): WorldRow => ({
	name,
	kind: "field",
	isDefault: false,
	tracked: null,
	manifestMtimeMs: Date.now(),
});

/** The daemon at the fetch boundary: `world.list` answers with `worlds`, the catalog GETs
 *  404 (a project without catalogs, the quietest legitimate shape). */
function stubDaemon(worlds: WorldRow[] = []): void {
	// Boundary cast: the stub implements the call signature and none of `fetch`'s statics.
	globalThis.fetch = mock((input: unknown) => {
		const url = String(input);
		if (!url.startsWith("/api/"))
			return Promise.resolve(new Response("", { status: 404 }));
		const body = url.endsWith("world.list")
			? { defaultName: null, worlds }
			: {};
		return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
	}) as unknown as typeof fetch;
}

async function renderShell(worlds: WorldRow[] = []) {
	stubDaemon(worlds);
	const stub = makeStubHost();
	const result = render(
		<EditorContext.Provider
			value={makeEditorContext({ fieldHostRef: { current: stub.host } })}
		>
			<Shell />
		</EditorContext.Provider>,
	);
	await settle();
	return { ...result, stub };
}

/** Two microtask turns — the catalog path awaits `fetch()` then `res.text()`. */
const settle = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});

const canvas = (): HTMLElement => screen.getByLabelText("field viewport");

/** Focus inside `act`, so React sees the commit. */
function focus(el: HTMLElement): void {
	act(() => {
		el.focus();
	});
}

/** Open `trigger` with the MOUSE. The pointerdown IS the gesture the record is taken at —
 *  in a browser it also precedes the focus transfer the click causes, which is exactly why
 *  the record lives there and not at the open edge. */
function openByPointer(trigger: HTMLElement): void {
	act(() => {
		fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
		fireEvent.click(trigger);
	});
}

/** Open `trigger` from the KEYBOARD. The keydown is the gesture; the click after it is
 *  what happy-dom needs to actually open a Radix surface (it synthesizes no click from ⏎)
 *  and it dispatches no pointer event, so it leaves the record alone. */
function openByKeyboard(trigger: HTMLElement): void {
	act(() => {
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(trigger);
	});
}

/** Dismiss with Escape and let Radix's DEFERRED close-autofocus run: it restores focus
 *  from a `setTimeout(…, 0)` scheduled at unmount (@radix-ui/react-focus-scope), which is
 *  also why a close-edge `useEffect` could never have won this race.
 *
 *  TWO `act`s, and the split is not tidiness: a timer awaited inside the same act as the
 *  keydown is SCHEDULED BEFORE React commits the unmount, so it fires before Radix's own
 *  and the assertion reads the DOM one turn too early. Cost the first version of this file
 *  eleven false reds. */
async function dismiss(): Promise<void> {
	act(() => {
		fireEvent.keyDown(document, { key: "Escape" });
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

/** The two assertions every positive half makes, by ELEMENT IDENTITY. `activeElement`
 *  defaults to `<body>` in happy-dom, so "focus returned" and "focus never moved" look
 *  alike against anything weaker than identity. */
function expectCanvasHasFocus(): void {
	expect(document.activeElement === canvas()).toBe(true);
}

// --- (a) the View popover: the surface that made this a normal-loop problem ---

test("the View popover hands focus BACK to the canvas when the canvas had it", async () => {
	await renderShell();
	focus(canvas());
	const trigger = screen.getByLabelText("view options");
	openByPointer(trigger);
	// Radix moved focus INTO the content. Asserted rather than assumed: it is the whole
	// reason the record cannot be `document.activeElement === canvas` at the open edge.
	expect(document.activeElement === canvas()).toBe(false);

	await dismiss();
	expectCanvasHasFocus();
});

test("the View popover LEAVES focus on its trigger when the user tabbed in", async () => {
	await renderShell();
	const trigger = screen.getByLabelText("view options");
	// The user walked here with the keyboard. The canvas never had focus, and taking it on
	// close would throw them out of the tab order they were walking (WCAG 2.4.3).
	focus(trigger);
	expect(document.activeElement === canvas()).toBe(false);
	openByKeyboard(trigger);

	await dismiss();
	expect(document.activeElement === trigger).toBe(true);
});

// --- (b) the rail's member flyout: the mouse's only route to Fill/Paint/Smooth

test("the rail flyout hands the canvas back — arming Fill mid-flight keeps the fly keys", async () => {
	await renderShell();
	focus(canvas());
	openByPointer(screen.getByRole("button", { name: "Brush tools" }));
	await settle();
	await dismiss();
	expectCanvasHasFocus();
});

test("the rail flyout LEAVES focus on its trigger when opened from the keyboard", async () => {
	await renderShell();
	const trigger = screen.getByRole("button", { name: "Brush tools" });
	focus(trigger);
	openByKeyboard(trigger);
	await settle();
	await dismiss();
	expect(document.activeElement === trigger).toBe(true);
});

// --- (c) the burger, and its hand-off ----------------------------------------

test("the burger hands the canvas back", async () => {
	await renderShell();
	focus(canvas());
	openByPointer(screen.getByLabelText("editor menu"));
	await settle();
	await dismiss();
	expectCanvasHasFocus();
});

test("the burger LEAVES focus on itself when opened from the keyboard", async () => {
	await renderShell();
	const trigger = screen.getByLabelText("editor menu");
	focus(trigger);
	openByKeyboard(trigger);
	await settle();
	await dismiss();
	expect(document.activeElement === trigger).toBe(true);
});

test("a burger HAND-OFF beats the canvas return: the surface just opened keeps focus", async () => {
	await renderShell();
	// Opened from the canvas, so the burger's own record says yes — and it must still not
	// fire, because this close exists to give focus to the View popover it just opened.
	focus(canvas());
	openByPointer(screen.getByLabelText("editor menu"));
	await settle();
	await act(async () => {
		fireEvent.click(screen.getByText("View options…"));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	// The popover is up and the canvas did NOT take focus out from under it.
	expect(screen.queryByLabelText("layers") === null).toBe(false);
	expect(document.activeElement === canvas()).toBe(false);
});

// --- (d) the ⌘K palette: no trigger at all, so Radix restores to nothing -----

test("the command palette hands the canvas back — ⌘K is pressed mid-flight", async () => {
	await renderShell();
	focus(canvas());
	// The keydown IS the gesture: no pointer is involved in a chord, and the record has to
	// answer for it or every keyboard-summoned surface is a dead end.
	await act(async () => {
		fireEvent.keyDown(window, { key: "k", metaKey: true });
		await Promise.resolve();
	});
	expect(document.activeElement === canvas()).toBe(false);

	await dismiss();
	expectCanvasHasFocus();
});

test("the command palette does NOT take the canvas when ⌘K came from the chrome", async () => {
	await renderShell();
	// Focus parked on a chrome control, exactly as it would be after a Tab walk.
	const chrome = screen.getByLabelText("editor menu");
	focus(chrome);
	await act(async () => {
		fireEvent.keyDown(window, { key: "k", metaKey: true });
		await Promise.resolve();
	});
	await dismiss();
	// Radix has no trigger to restore to for this dialog, so focus lands on `<body>` —
	// pre-existing and NOT what this task is about. What is asserted is the half that is:
	// the canvas does not seize focus it was never given.
	expect(document.activeElement === canvas()).toBe(false);
});

// --- (e) the stats chip: read a number, keep flying --------------------------

test("a status chip's popover hands the canvas back", async () => {
	const { stub } = await renderShell();
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 12 }));
	});
	focus(canvas());
	openByPointer(within(screen.getByRole("contentinfo")).getByLabelText(/ops/));
	await settle();
	await dismiss();
	expectCanvasHasFocus();
});

test("a status chip's popover LEAVES focus on its chip when opened from the keyboard", async () => {
	const { stub } = await renderShell();
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 12 }));
	});
	const chip = within(screen.getByRole("contentinfo")).getByLabelText(/ops/);
	focus(chip);
	openByKeyboard(chip);
	await settle();
	await dismiss();
	expect(document.activeElement === chip).toBe(true);
});

// --- (f) the strip's ⋯: the complete option list, reached mid-stroke ---------

test("the strip's ⋯ popover hands the canvas back", async () => {
	await renderShell();
	act(() => {
		fireEvent.keyDown(window, { key: "b" });
	});
	focus(canvas());
	openByPointer(screen.getByRole("button", { name: /^all dig options/ }));
	await settle();
	await dismiss();
	expectCanvasHasFocus();
});

test("the strip's ⋯ popover LEAVES focus on itself when opened from the keyboard", async () => {
	await renderShell();
	act(() => {
		fireEvent.keyDown(window, { key: "b" });
	});
	const trigger = screen.getByRole("button", { name: /^all dig options/ });
	focus(trigger);
	openByKeyboard(trigger);
	await settle();
	await dismiss();
	expect(document.activeElement === trigger).toBe(true);
});

// --- (g) the world drawer, and the STACKED case ------------------------------

test("the world drawer hands the canvas back", async () => {
	await renderShell();
	focus(canvas());
	openByPointer(screen.getByRole("button", { name: /untitled/ }));
	await settle();
	await dismiss();
	expectCanvasHasFocus();
});

test("the world drawer does NOT take the canvas when the chip was reached by keyboard", async () => {
	await renderShell();
	const chip = screen.getByRole("button", { name: /untitled/ });
	focus(chip);
	openByKeyboard(chip);
	await settle();
	await dismiss();
	expect(document.activeElement === canvas()).toBe(false);
});

test("two stacked overlays each answer for their OWN summoning", async () => {
	// THE per-overlay-record case. The drawer is opened from the canvas (its record: yes);
	// the row's ⋯ menu is opened from inside the drawer (its record: no). Dismissing the
	// inner one must go back to the ⋯ it came from — the canvas is not where THAT gesture
	// started, and taking focus out of a modal dialog's trap would be wrong twice over —
	// while dismissing the outer one still goes home. One shared record cannot express
	// this: the inner open would overwrite the drawer's answer and strand the user.
	await renderShell([world("cavern")]);
	focus(canvas());
	openByPointer(screen.getByRole("button", { name: /untitled/ }));
	await settle();

	const more = await screen.findByLabelText("more actions for cavern");
	openByPointer(more);
	await settle();
	await dismiss();
	// The INNER dismissal: back to the ⋯, and emphatically not to the canvas.
	expect(document.activeElement === more).toBe(true);
	expect(document.activeElement === canvas()).toBe(false);
	// The drawer is still standing — the Escape above was the menu's.
	expect(screen.queryByLabelText("filter worlds") === null).toBe(false);

	await dismiss();
	// The OUTER dismissal: the drawer's own record, untouched by the inner overlay.
	expectCanvasHasFocus();
});

// --- (h) the two surfaces the canvas cannot summon ---------------------------
//
// `ConfirmDialog` is App-owned (it sits beside the Shell, not inside it) and
// `ShortcutsDialog` is only reachable through the burger, so neither can be driven from a
// focused canvas in a Shell fixture. They are exercised against a STUB seam instead, which
// is the honest split: the cases above prove `CanvasHost`'s recorder end to end, and these
// prove the two sites read it and act on it.

/** A viewport seam that answers whatever the case says, and records whether `focus()` was
 *  called. Nothing here is a canvas: the claim under test is "the site consults the seam
 *  and acts on the answer", and a fake makes the two polarities settable. */
function stubViewport(held: boolean): {
	ref: { current: ViewportFocus | null };
	focused: () => number;
} {
	let focused = 0;
	return {
		ref: {
			current: {
				focus: () => {
					focused += 1;
				},
				heldFocusAtGestureStart: () => held,
			},
		},
		focused: () => focused,
	};
}

/** A dialog these cases drive OPEN-to-CLOSED themselves: both surfaces take their open
 *  state from a prop, so a fixture that never changes it never dismisses at all — Escape
 *  reaches `onOpenChange` and nothing else happens. `Dismissable` below owns that state. */
function Dismissable({
	render,
}: {
	render: (
		open: boolean,
		onOpenChange: (open: boolean) => void,
	) => ReactElement;
}) {
	const [open, setOpen] = useState(true);
	return render(open, setOpen);
}

const CONFIRM = {
	title: "Delete entities?",
	message: "Delete 2 selected entities?",
	confirmLabel: "Delete",
	// biome-ignore lint/suspicious/noEmptyBlockStatements: the prompt's verb is inert here
	onConfirm: () => {},
};

function renderConfirm(viewport: ReturnType<typeof stubViewport>): void {
	renderWithEditor(
		<Dismissable
			render={(open, setOpen) => (
				<ConfirmDialog
					request={open ? CONFIRM : null}
					onResolve={() => setOpen(false)}
				/>
			)}
		/>,
		makeEditorContext({ viewportFocusRef: viewport.ref }),
	);
}

test("the confirm dialog hands the canvas back when ⌫ was pressed over the canvas", async () => {
	const viewport = stubViewport(true);
	renderConfirm(viewport);
	await dismiss();
	expect(viewport.focused()).toBe(1);
});

test("the confirm dialog does NOT take the canvas when the prompt came from the chrome", async () => {
	const viewport = stubViewport(false);
	renderConfirm(viewport);
	await dismiss();
	expect(viewport.focused()).toBe(0);
});

/** The shortcuts overlay renders FROM the action registry, so it needs the provider stack
 *  the Shell would give it — in the Shell's own order. Nothing here pushes; the stub host
 *  is inert and the daemon is not consulted. */
function renderShortcuts(viewport: ReturnType<typeof stubViewport>): void {
	const stub = makeStubHost();
	renderWithEditor(
		<FieldHostStateProvider host={stub.host} engineReady store={undefined}>
			<ViewProvider host={stub.host} engineReady store={undefined}>
				<CatalogProvider>
					<WorldProvider>
						<WorkspaceProvider store={undefined}>
							<ActionContextProvider
								host={stub.host}
								// biome-ignore lint/suspicious/noEmptyBlockStatements: nothing opens ⌘K here
								openCommandPalette={() => {}}
							>
								<Dismissable
									render={(open, setOpen) => (
										<ShortcutsDialog open={open} onOpenChange={setOpen} />
									)}
								/>
							</ActionContextProvider>
						</WorkspaceProvider>
					</WorldProvider>
				</CatalogProvider>
			</ViewProvider>
		</FieldHostStateProvider>,
		makeEditorContext({
			fieldHostRef: { current: stub.host },
			viewportFocusRef: viewport.ref,
		}),
	);
}

test("the shortcuts overlay hands the canvas back when it was summoned from one", async () => {
	const viewport = stubViewport(true);
	renderShortcuts(viewport);
	await dismiss();
	expect(viewport.focused()).toBe(1);
});

test("the shortcuts overlay does NOT take the canvas when it was summoned from the chrome", async () => {
	const viewport = stubViewport(false);
	renderShortcuts(viewport);
	await dismiss();
	expect(viewport.focused()).toBe(0);
});

// --- (i) the recorder itself -------------------------------------------------

test("the record is taken at GESTURE start, and a later gesture from the chrome replaces it", async () => {
	// The compound flow a single "was the canvas focused" snapshot gets wrong: the user
	// flies, clicks a chrome control, then Tabs on and opens something from the keyboard.
	// The chrome keydown is a gesture too, so the stale yes is overwritten by a no.
	await renderShell();
	focus(canvas());
	const chip = screen.getByRole("button", { name: /untitled/ });
	// A click on chrome while flying — the record says yes at this instant.
	act(() => {
		fireEvent.pointerDown(chip, { button: 0, pointerType: "mouse" });
	});
	// …and then the user walks on with the keyboard and opens the View popover from there.
	const trigger = screen.getByLabelText("view options");
	focus(trigger);
	openByKeyboard(trigger);
	await dismiss();
	expect(document.activeElement === trigger).toBe(true);
});

test("the return stands down when another surface has claimed focus in the meantime", async () => {
	// Clicking a SECOND trigger dismisses the first overlay: that close fires while the new
	// surface already holds focus, and the canvas must not take it and shut what the user
	// just opened. It is the same guard `useRovingList`'s recovery uses.
	await renderShell();
	focus(canvas());
	openByPointer(screen.getByLabelText("view options"));
	// Radix installs its outside-pointerdown listener from a `setTimeout(…, 0)`, so a
	// dismissal driven in the same turn as the open is simply not heard.
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	// Both halves of the gesture: with `deferPointerDownOutside` (which a popover sets) the
	// outside dismissal is held until the CLICK, so a pointerdown alone closes nothing.
	openByPointer(screen.getByLabelText("editor menu"));
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	expect(screen.queryByLabelText("layers") === null).toBe(true);
	// The burger took focus on open and kept it: the popover's dismissal did not drag the
	// keyboard back to the canvas and shut the menu the user was reaching for.
	expect(document.activeElement === canvas()).toBe(false);
	expect(screen.queryByText("View options…") === null).toBe(false);
});
