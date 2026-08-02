// cmdk's parts in the editor's tokens — shadcn's `command.tsx` shape, nothing more.
//
// This file is PRESENTATION only. It knows nothing about the action registry: what the
// rows are, what they are called and when they refuse is `shell/CommandPalette.tsx`'s
// business, exactly as `dropdown-menu.tsx` knows nothing about the burger's tree.
//
// TWO deviations from the shadcn source, both forced by this build:
//   - the `animate-in` / `fade-*` / `zoom-*` utilities are NO-OPS here (no
//     tailwindcss-animate plugin), so the dialog's motion is the hand-authored
//     `furnace-*` keyframes it inherits from `dialog.tsx`;
//   - only the parts the palette actually renders are exported. `CommandSeparator` and
//     `CommandLoading` have no caller — a primitive with no consumer is surface to keep
//     true for nothing.
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/cn.ts";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "./dialog.tsx";

const Command = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
	<CommandPrimitive
		ref={ref}
		className={cn(
			"flex w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
			className,
		)}
		{...props}
	/>
));
Command.displayName = CommandPrimitive.displayName;

/** The palette in a modal dialog: OUR dialog, not cmdk's own `Command.Dialog`, so the
 *  overlay, the border, the radius and the enter/exit keyframes are the same ones every
 *  other modal in the editor uses.
 *
 *  Geometry is the mock's frame 5: 480 px wide, pinned 84 px from the top rather than
 *  centred — a list that grows downward should not shift its own input as it filters, and
 *  a vertically-centred one does exactly that.
 *
 *  `title` and `description` are rendered for screen readers only. Radix warns (and a
 *  dialog genuinely is unusable) without them, and neither belongs on screen: the input's
 *  placeholder says what to do and the footer says how to leave. */
function CommandDialog({
	open,
	onOpenChange,
	title,
	description,
	onEscapeKeyDown,
	ref,
	onCloseAutoFocus,
	children,
	...commandProps
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	/** Radix's own escape hook, on the CONTENT — forwarded because the dialog box is the
	 *  outermost thing a press inside the palette passes through, and a handler on the
	 *  `Command` root below would miss any press whose target is the box itself. */
	onEscapeKeyDown?: (event: KeyboardEvent) => void;
	/** The focus-return seam, on the CONTENT. Named EXPLICITLY, unlike every other prop
	 *  here: `...commandProps` goes to cmdk's `Command` root, which knows nothing about
	 *  either — so a palette spreading `useViewportFocusReturn()` onto this component
	 *  would land two dead props on a div and lose the focus return with nothing thrown.
	 *  `ref` is the one that RECORDS the open, and it has to reach `DialogContent`: on
	 *  cmdk's root it would attach a commit too late and to the wrong element. */
	ref?: (element: HTMLElement | null) => void;
	onCloseAutoFocus?: (event: Event) => void;
} & Omit<React.ComponentPropsWithoutRef<typeof Command>, "ref">) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				onEscapeKeyDown={onEscapeKeyDown}
				ref={ref}
				onCloseAutoFocus={onCloseAutoFocus}
				className="top-[84px] max-w-[480px] translate-y-0 gap-0 overflow-hidden p-0"
			>
				<DialogTitle className="sr-only">{title}</DialogTitle>
				<DialogDescription className="sr-only">{description}</DialogDescription>
				{/* `label` is cmdk's OWN naming hook and it is not optional here. cmdk points
				    `Command.Input`'s `aria-labelledby` at an internal element that stays EMPTY
				    until this prop fills it, so the search box shipped as a `role="combobox"`
				    whose name resolved to "" — a present-but-empty `aria-labelledby`, which is
				    worse than none, since it is the branch the name computation reaches first.
				    Fed from `title` rather than taken as a second prop: the dialog and the box
				    inside it are the same surface, and two spellings of one name is how they
				    drift. Before the spread, so a caller that wants them different still can. */}
				<Command label={title} {...commandProps}>
					{children}
				</Command>
			</DialogContent>
		</Dialog>
	);
}

const CommandInput = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Input>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
	<div className="flex items-center gap-2.5 border-border border-b px-3.5 py-2.5">
		<Search
			className="h-4 w-4 shrink-0 text-muted-foreground"
			aria-hidden="true"
		/>
		<CommandPrimitive.Input
			ref={ref}
			className={cn(
				"flex h-5 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground",
				className,
			)}
			{...props}
		/>
	</div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.List>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
	<CommandPrimitive.List
		ref={ref}
		// Capped and scrollable: the whole registry is ~40 rows and a list that grows past
		// the window takes its own footer off screen.
		className={cn(
			"max-h-[52vh] overflow-y-auto overflow-x-hidden p-1",
			className,
		)}
		{...props}
	/>
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Empty>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
	<CommandPrimitive.Empty
		ref={ref}
		className="py-6 text-center text-muted-foreground text-xs"
		{...props}
	/>
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Group>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
	<CommandPrimitive.Group
		ref={ref}
		className={cn(
			"overflow-hidden text-foreground [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide",
			className,
		)}
		{...props}
	/>
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandItem = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
	<CommandPrimitive.Item
		ref={ref}
		className={cn(
			"relative flex cursor-default select-none items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-xs outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
			// Refused rows stay VISIBLE and stay in the list — finding a verb and learning
			// why it will not run is the whole point of showing them. cmdk writes
			// `aria-disabled` (never the `disabled` attribute) and skips them for arrow
			// navigation, auto-selection and ⏎, which is the rail's posture exactly.
			// 50 %, the chrome's one dimmed tier (D-23).
			"data-[disabled=true]:opacity-50",
			className,
		)}
		{...props}
	/>
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

/** The keycap at the end of a row. A `<kbd>`, like the shortcuts overlay's. */
function CommandShortcut({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="ml-auto font-mono text-2xs text-muted-foreground">
			{children}
		</kbd>
	);
}

export {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
};
