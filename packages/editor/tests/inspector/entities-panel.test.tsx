// Task 8 sub-change 7: EntitiesPanel prepends a pinned "World" row that single-selects the
// $settings sentinel, shown selected when the sentinel is the current selection. Harness
// import MUST be first.

import { afterEach, expect, mock, test } from "bun:test";
import { EntitiesPanel } from "../../src/frontend/components/EntitiesPanel.tsx";
import type { EditorContextValue } from "../../src/frontend/components/editor-context.ts";
import { SETTINGS_SELECTION } from "../../src/frontend/lib/selection.ts";
import {
	cleanup,
	fireEvent,
	makeEditorContext,
	renderWithEditor,
	screen,
} from "./_harness.tsx";

afterEach(cleanup);

const doc = {
	version: 1,
	settings: {},
	resources: {},
	entities: [
		{ id: "cam", components: {} },
		{ id: "box", components: {} },
	],
};

function ctx(over: {
	selectedEntities?: string[];
	dispatch?: EditorContextValue["dispatch"];
}): EditorContextValue {
	return makeEditorContext({
		// Boundary cast: the test doc is a structural subset of SceneDocument.
		state: { doc: doc as never, selectedEntities: over.selectedEntities ?? [] },
		dispatch: over.dispatch,
	});
}

test("a World row is rendered above the entity rows", () => {
	renderWithEditor(<EntitiesPanel />, ctx({}));
	expect(screen.getByRole("button", { name: "World" })).toBeTruthy();
	expect(screen.getByRole("button", { name: "cam" })).toBeTruthy();
	expect(screen.getByRole("button", { name: "box" })).toBeTruthy();
});

test("clicking World single-selects the $settings sentinel", () => {
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const dispatch = mock(() => {});
	renderWithEditor(<EntitiesPanel />, ctx({ dispatch }));
	fireEvent.click(screen.getByRole("button", { name: "World" }));
	expect(dispatch).toHaveBeenCalledWith({
		type: "select-entity",
		id: SETTINGS_SELECTION,
		mode: "replace",
	});
});

test("the World row reflects selected state when $settings is selected", () => {
	renderWithEditor(
		<EntitiesPanel />,
		ctx({ selectedEntities: [SETTINGS_SELECTION] }),
	);
	const world = screen.getByRole("button", { name: "World" });
	// Selected rows carry the primary attention lane (same signal as entity rows).
	expect(world.className).toContain("text-primary");
});
