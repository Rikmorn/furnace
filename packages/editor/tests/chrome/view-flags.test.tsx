// Harness tests for the Task 9 chrome: the corner axis triad and the View▸View-flags menu.
// Lives under tests/chrome/ (like menubar.test.tsx) so the happy-dom registration never
// pollutes the daemon HTTP suites that run later in the same bun process.

import { afterEach, expect, mock, test } from "bun:test";
import { AxisTriad } from "../../src/frontend/components/AxisTriad.tsx";
import { MenuBar } from "../../src/frontend/components/MenuBar.tsx";
import {
	type EditorState,
	initialState,
} from "../../src/frontend/lib/state.ts";
import { cleanup, fireEvent, render, screen } from "../inspector/_harness.tsx";

afterEach(cleanup);

// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
const noop = () => {};
const VIEW_FLAGS = { grid: true, axes: true, headlamp: true, fog: false };
const menuBarProps = {
	onSave: noop,
	onUndo: noop,
	onRedo: noop,
	onDelete: noop,
	openPanelIds: ["entities", "viewport", "inspect", "generation"],
	onTogglePanel: noop,
	onResetLayout: noop,
	recentScenes: [] as string[],
	onSelectScene: noop,
	viewFlags: VIEW_FLAGS,
	onToggleViewFlag: noop,
};

const st = (over: Partial<EditorState> = {}): EditorState => ({
	...initialState,
	status: "ready",
	...over,
});

// --- AxisTriad (pure SVG, no context/portals) ---

test("AxisTriad renders the three semantic axis labels", () => {
	render(<AxisTriad yaw={0.4} pitch={0.5} />);
	expect(screen.getByText("X")).toBeTruthy();
	expect(screen.getByText("Y")).toBeTruthy();
	expect(screen.getByText("Z")).toBeTruthy();
});

test("AxisTriad exposes an accessible label", () => {
	render(<AxisTriad yaw={0} pitch={0} />);
	expect(screen.getByRole("img", { name: /orientation axes/i })).toBeTruthy();
});

// --- View▸View flags menu (trigger-level; submenu contents are browser-gated) ---

test("View▸View flags is now enabled (was a Task-5 disabled placeholder)", () => {
	render(<MenuBar state={st()} {...menuBarProps} />);
	const trigger = screen.getByText("View");
	fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
	fireEvent.click(trigger);
	const flags = screen.getByRole("menuitem", { name: /View flags/ });
	expect(flags.hasAttribute("data-disabled")).toBe(false);
});

test("MenuBar accepts the view-flag toggle callback without error", () => {
	const onToggleViewFlag = mock(noop);
	// Rendering with the wired callback is the unit boundary here; the submenu
	// checkbox interaction is exercised in the browser gate.
	render(
		<MenuBar
			state={st()}
			{...menuBarProps}
			onToggleViewFlag={onToggleViewFlag}
		/>,
	);
	expect(screen.getByText("View")).toBeTruthy();
});
