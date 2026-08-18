// Registered FIRST — the shell.test.tsx rule; see `boolean-field.test.tsx` for the mechanism
// and the measurement.
import "./_register.ts";

// D-25's refusal contract: validation AT the field, with the commit verb explaining it.
//
// The shape matters more than the copy. A form that collects its refusals into a bag and
// prints them under the submit button makes the user scroll to find out which of nine
// numbers is wrong — so the bag does not exist here. `SchemaForm` holds ONE offending
// field at a time, which is not a simplification but a consequence: a refused draft is not
// written, so the only field that can be in error is the one under the cursor. There is no
// list to dump, by construction.
//
// The other half is the REFUSAL ITSELF: an out-of-bounds value must not reach `onPreview`.
// The card previews into a live worker ghost, so a value the generator will throw on is a
// round-trip and an error toast to say what the schema already knew.

import { afterEach, expect, mock, test } from "bun:test";
import { SchemaForm } from "../../src/frontend/inspector/index.tsx";
import { cleanup, fireEvent, render, screen } from "./_harness.tsx";

afterEach(cleanup);

/** A hall-shaped bounded integer param, wide enough to render as a slider. Two of them:
 *  the deferral case needs a SECOND field to move focus to without blurring the one
 *  holding the refusal. */
const WIDTH = {
	type: "object",
	properties: {
		width: { type: "number", minimum: 3, maximum: 24, multipleOf: 1 },
		depth: { type: "number", minimum: 3, maximum: 24, multipleOf: 1 },
	},
};

function renderForm(value: Record<string, unknown> = { width: 8, depth: 8 }) {
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onPreview = mock((_next: unknown) => {});
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onCommit = mock((_next: unknown) => {});
	const onInvalid = mock(
		// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
		(_bad: { path: string; message: string } | null) => {},
	);
	render(
		<SchemaForm
			schema={WIDTH}
			value={value}
			onPreview={onPreview}
			onCommit={onCommit}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onCancel={() => {}}
			onInvalid={onInvalid}
		/>,
	);
	const exact = screen.getByRole("textbox", {
		name: "Width exact",
	}) as HTMLInputElement;
	return { exact, onPreview, onCommit, onInvalid };
}

/** The onInvalid spy the two re-seed cases share, rebuilt per case. */
let lastInvalid: ReturnType<typeof mock<(bad: unknown) => void>>;

/** The form as an ELEMENT, so a case can `rerender` it with a new `value` — which is what
 *  an external host push looks like (the stamp seam clones the session on every notify,
 *  so a fresh object identity is the production shape, not a synthetic one). */
function refusableForm(value: unknown) {
	return (
		<SchemaForm
			schema={WIDTH}
			value={value}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onPreview={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onCommit={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onCancel={() => {}}
			onInvalid={lastInvalid}
		/>
	);
}

function renderRefusable(value: unknown) {
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	lastInvalid = mock((_bad: unknown) => {});
	return render(refusableForm(value));
}

test("an out-of-bounds value refuses AT the field and never previews", () => {
	const { exact, onPreview, onCommit } = renderForm();
	exact.focus();
	fireEvent.change(exact, { target: { value: "2" } });
	// The reason renders in the row, in the schema's own numbers.
	expect(screen.getByRole("alert").textContent).toContain("must be at least 3");
	// …and the host never sees it. A preview would spend a worker round trip to be told
	// what `minimum: 3` already says.
	expect(onPreview).not.toHaveBeenCalled();
	fireEvent.blur(exact);
	expect(onCommit).not.toHaveBeenCalled();
});

test("the offending FIELD is named upward, so the verb can explain its own refusal", () => {
	const { exact, onInvalid } = renderForm();
	exact.focus();
	fireEvent.change(exact, { target: { value: "2" } });
	expect(onInvalid).toHaveBeenLastCalledWith({
		path: "width",
		message: "must be at least 3",
	});
});

test("correcting the value clears the refusal on both channels", () => {
	const { exact, onPreview, onInvalid } = renderForm();
	exact.focus();
	fireEvent.change(exact, { target: { value: "2" } });
	fireEvent.change(exact, { target: { value: "9" } });
	// `queryByRole` returns null when absent; compare to null FIRST (a failing
	// `toBeNull()` on a happy-dom element serialises React's fiber graph and hangs).
	expect(screen.queryByRole("alert") === null).toBe(true);
	expect(onInvalid).toHaveBeenLastCalledWith(null);
	expect(onPreview).toHaveBeenLastCalledWith({ width: 9, depth: 8 });
});

test("a fractional value on a whole-number param refuses too", () => {
	// The live defect at HEAD: a hall width of 8.5 is accepted by the field, previewed,
	// and thrown back by `intParam` from inside the worker — "hall: width must be an
	// integer in [4, 24], got 8.5" — with the field still showing 8.5 as if it took.
	const { exact, onPreview } = renderForm();
	exact.focus();
	fireEvent.change(exact, { target: { value: "8.5" } });
	expect(screen.getByRole("alert").textContent).toContain(
		"must be a whole number",
	);
	expect(onPreview).not.toHaveBeenCalled();
});

test("a valid value still previews per keystroke and commits on blur", () => {
	// The guard must not be a brake: this is the case that fails if the refusal path
	// swallowed everything rather than only the invalid drafts.
	const { exact, onPreview, onCommit } = renderForm();
	exact.focus();
	fireEvent.change(exact, { target: { value: "12" } });
	expect(onPreview).toHaveBeenLastCalledWith({ width: 12, depth: 8 });
	fireEvent.blur(exact);
	expect(onCommit).toHaveBeenLastCalledWith({ width: 12, depth: 8 });
});

test("an external RE-SEED clears a standing refusal", () => {
	// The mount-surviving flavour of the unmount case below, and the one that actually
	// bites: the card is NOT remounted on a subject change (`SessionCardPresence` only
	// calls `setDrivenOpen("session", true)`, which is already true), so the SAME form
	// instance sees a brand-new `value` identity. Refuse a field, then let any external push
	// land — a different entity's reconfigure, a ⚄ reroll, an undo, an SSE change. The
	// field re-seeds to the incoming valid number, so a refusal that outlived it is about
	// text nobody can see any more, and it keeps the commit verb disabled naming a field
	// that is now fine. The only exit was to edit that field again.
	//
	// The form's own header reasons about the INTRA-form case ("a refused draft is never
	// written, so a row stays wrong until its own field is fixed") — true, and silent
	// about this one, which is why it took a probe rather than a read to find.
	const view = renderRefusable({ width: 8, depth: 8 });
	const exact = screen.getByRole("textbox", {
		name: "Width exact",
	}) as HTMLInputElement;
	exact.focus();
	fireEvent.change(exact, { target: { value: "99" } });
	// `focusout`, not `blur`: React attaches the focus pair at the root and only the
	// bubbling event reaches `SchemaForm`'s `onBlurCapture`, which is what releases the
	// echo guard. A non-bubbling `blur` reaches the INPUT's own handler and leaves the
	// form still believing it is being typed into.
	fireEvent.focusOut(exact);
	expect(screen.getByRole("alert").textContent).toContain("must be at most 24");

	view.rerender(refusableForm({ width: 12, depth: 8 }));
	// The field shows the incoming value…
	expect(exact.value).toBe("12");
	// …so the refusal about the old text must be gone from BOTH channels.
	// `queryByRole` returns null when absent; compare to null FIRST (house rule).
	expect(screen.queryByRole("alert") === null).toBe(true);
	expect(lastInvalid.mock.calls.at(-1)?.[0]).toBe(null);
});

test("a re-seed DEFERRED by focus keeps the refusal until the field is actually re-seeded", () => {
	// The other side of the same branch, and the reason the clear cannot simply hang off
	// "a new `value` arrived": the echo guard DEFERS a re-seed while an input has focus,
	// precisely so an external edit does not clobber what the user is typing. Clearing the
	// refusal there would leave the offending text on screen with nothing explaining why
	// the commit verb is dead — the exact state this whole channel exists to prevent.
	const view = renderRefusable({ width: 8, depth: 8 });
	const width = screen.getByRole("textbox", {
		name: "Width exact",
	}) as HTMLInputElement;
	const depth = screen.getByRole("textbox", {
		name: "Depth exact",
	}) as HTMLInputElement;
	width.focus();
	fireEvent.change(width, { target: { value: "99" } });
	expect(screen.getByRole("alert").textContent).toContain("must be at most 24");

	// Focus moves to the SIBLING field, so it never leaves the form: `onBlurCapture`'s
	// `contains(relatedTarget)` guard holds and the echo guard stays armed. Moving to a
	// second field rather than blurring the first is deliberate — see the note below.
	fireEvent.focusIn(depth);
	// The push lands with focus still inside the form.
	view.rerender(refusableForm({ width: 12, depth: 8 }));
	// The typed text is untouched (the echo guard did its job)…
	expect(width.value).toBe("99");
	// …so its explanation must be too. Clearing here would leave the offending text on
	// screen with nothing saying why the commit verb is dead.
	expect(screen.getByRole("alert").textContent).toContain("must be at most 24");

	// …and now focus leaves the form entirely, which is where the deferred re-seed finally
	// runs. This half is what the first sabotage round MISSED: reverting only the
	// blur-capture branch to a bare `setDrafts` left the whole suite green, because the
	// case above stops at the deferral and the case before it never defers.
	fireEvent.focusOut(depth);
	// `queryByRole` returns null when absent; compare to null FIRST (house rule).
	expect(screen.queryByRole("alert") === null).toBe(true);
	expect(lastInvalid.mock.calls.at(-1)?.[0]).toBe(null);
});

// WHY THE CASE ABOVE MOVES FOCUS TO A SIBLING instead of simply blurring the refused field:
// blurring it directly hits a SECOND, narrower defect that this task's fix does not close,
// and writing the test that way would have made a passing assertion impossible to get
// honestly. `ExactNumberInput`'s own `onBlur` commits its buffered text, and React runs the
// form's `onBlurCapture` (capture, downward) BEFORE the input's `onBlur` (bubble, upward) —
// so the form clears the refusal and the input then re-commits the stale "99", which is
// refused again. Observed: the input correctly shows the incoming "12" while the row still
// prints `must be at most 24`, about text that is no longer anywhere on screen.
//
// It is a different mechanism from the one fixed here (a buffered input cannot tell that
// its text was superseded mid-edit) and closing it is a contract change to
// `ExactNumberInput`, so it is FILED rather than fixed:
// `docs/backlog/editor-and-tooling/buffered-numeric-input-commits-stale-text.md`.

test("unmounting the form retracts its refusal", () => {
	// The card unmounts the form whenever its palette closes or the record turns
	// read-only. A refusal that outlived the form would leave the commit verb disabled
	// with a reason naming a field nothing is rendering.
	const { exact, onInvalid } = renderForm();
	exact.focus();
	fireEvent.change(exact, { target: { value: "2" } });
	expect(onInvalid.mock.calls.at(-1)?.[0]).not.toBe(null);
	cleanup();
	expect(onInvalid.mock.calls.at(-1)?.[0]).toBe(null);
});
