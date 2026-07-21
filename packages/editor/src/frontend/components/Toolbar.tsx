import { type LucideIcon, Redo2, Save, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import type { ViewFlags } from "../../viewport-host/index.ts"; // type-only: erased
import { cn } from "../lib/cn.ts";
import type { PanelId } from "../lib/panels.ts";
import type { EditorState } from "../lib/state.ts";
import { MenuBar } from "./MenuBar.tsx";
import { Button } from "./ui/button.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./ui/select.tsx";

/** One icon-only toolbar action (Save/Undo/Redo share this shape). `aria-label` is the
 *  button's accessible name (the toolbar tests query by it); `children` carries extra
 *  overlay content (Save's dirty dot). */
function ToolbarIconButton({
	icon: Icon,
	label,
	title,
	disabled,
	onClick,
	className,
	children,
}: {
	icon: LucideIcon;
	label: string;
	title: string;
	disabled: boolean;
	onClick: () => void;
	className?: string;
	children?: ReactNode;
}) {
	return (
		<Button
			size="icon"
			variant="ghost"
			className={cn("h-8 w-8", className)}
			title={title}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
		>
			<Icon />
			{children}
		</Button>
	);
}

export function Toolbar({
	state,
	onSelectScene,
	onSave,
	onUndo,
	onRedo,
	onDelete,
	openPanelIds,
	onTogglePanel,
	onResetLayout,
	recentScenes,
	viewFlags,
	onToggleViewFlag,
}: {
	state: EditorState;
	onSelectScene: (p: string) => void;
	onSave: () => void;
	onUndo: () => void;
	onRedo: () => void;
	onDelete: () => void;
	openPanelIds: string[];
	onTogglePanel: (id: PanelId) => void;
	onResetLayout: () => void;
	recentScenes: string[];
	viewFlags: ViewFlags;
	onToggleViewFlag: (key: keyof ViewFlags, value: boolean) => void;
}) {
	// Natural-sort the scene list so e.g. "scene2" precedes "scene10".
	const sortedScenes = [...state.scenes].sort((a, b) =>
		a.localeCompare(b, undefined, { numeric: true }),
	);
	return (
		<header className="flex items-center gap-1 border-b border-border px-3 py-1.5">
			{/* The wordmark shrinks to a compact mark; the menu + controls own the left. */}
			<span
				className="select-none pr-1 text-sm font-semibold tracking-tight"
				title="furnace editor"
			>
				furnace
			</span>
			<MenuBar
				state={state}
				onSave={onSave}
				onUndo={onUndo}
				onRedo={onRedo}
				onDelete={onDelete}
				openPanelIds={openPanelIds}
				onTogglePanel={onTogglePanel}
				onResetLayout={onResetLayout}
				recentScenes={recentScenes}
				onSelectScene={onSelectScene}
				viewFlags={viewFlags}
				onToggleViewFlag={onToggleViewFlag}
			/>
			<div className="ml-2 flex items-center gap-0.5">
				<ToolbarIconButton
					icon={Save}
					label="Save"
					title="Save (⌘S)"
					disabled={!state.dirty}
					onClick={onSave}
					className="relative"
				>
					{state.dirty && (
						<span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
					)}
				</ToolbarIconButton>
				<ToolbarIconButton
					icon={Undo2}
					label="Undo"
					title="Undo (⌘Z)"
					disabled={!state.canUndo}
					onClick={onUndo}
				/>
				<ToolbarIconButton
					icon={Redo2}
					label="Redo"
					title="Redo (⇧⌘Z)"
					disabled={!state.canRedo}
					onClick={onRedo}
				/>
			</div>
			<div className="ml-auto flex items-center gap-2 text-sm">
				<span className="text-muted-foreground">scene:</span>
				{/* Radix Select: undefined value shows the placeholder; onValueChange fires
            only for a real item pick (so the old `e.target.value &&` guard is gone). */}
				<Select
					value={state.selectedScene ?? undefined}
					disabled={state.status !== "ready" || state.loading}
					onValueChange={onSelectScene}
				>
					<SelectTrigger className="h-8 w-56">
						<SelectValue
							placeholder={
								state.scenes.length ? "pick a scene" : "no scenes found"
							}
						/>
					</SelectTrigger>
					<SelectContent>
						{sortedScenes.map((s) => (
							<SelectItem key={s} value={s}>
								{s}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</header>
	);
}
