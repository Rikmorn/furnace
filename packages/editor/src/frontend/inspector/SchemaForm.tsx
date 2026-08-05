import {
	Component,
	type ErrorInfo,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { resolveKind } from "./kind.ts";
import { shouldReseed } from "./lib/echo-guard.ts";
import { getAtPath, setAtPath } from "./lib/paths.ts";
import { validateNumber } from "./lib/validate.ts";
import { fallbackRenderer, registry } from "./registry.tsx";
import type { JsonSchemaNode } from "./types.ts";

class RowErrorBoundary extends Component<
	{ path: string; children: ReactNode },
	{ error?: Error }
> {
	override state: { error?: Error } = {};
	static getDerivedStateFromError(error: Error) {
		return { error };
	}
	override componentDidCatch(error: Error, info: ErrorInfo) {
		console.error(
			`[inspector] field "${this.props.path}" threw:`,
			error,
			info.componentStack,
		);
	}
	override render() {
		if (this.state.error)
			return (
				<p className="py-1 font-mono text-xs text-destructive-text">
					{this.props.path}: {this.state.error.message}
				</p>
			);
		return this.props.children;
	}
}

/** A field that refused its own value: which one, and why — as a sentence fragment that
 *  reads after the field's label ("Width **must be at least 3**"). */
export type FieldRefusal = { path: string; message: string };

export type SchemaFormProps = {
	schema: JsonSchemaNode; // an object schema (the generator's params)
	/**
	 * The target's params object. Re-seeding is keyed on IDENTITY, not on a deep
	 * compare — hand this a fresh object per render and every render re-seeds the
	 * drafts.
	 */
	value: unknown;
	onPreview: (next: unknown) => void;
	onCommit: (next: unknown) => void;
	onCancel: () => void;
	/**
	 * The FIRST field currently refusing its value, in the schema's own property order,
	 * or `null` when every field is admissible. Called whenever that changes and once
	 * with `null` on unmount.
	 *
	 * ONE refusal, not a list, and that is the D-25 shape rather than a simplification: a
	 * consumer holding a bag of errors is one render away from printing them under its
	 * submit button, which is exactly the bottom-of-form dump the vocabulary exists to
	 * retire. Every refusal already renders at its own field; what a commit verb needs is
	 * the NAME of the one to look at.
	 */
	onInvalid?: (refusal: FieldRefusal | null) => void;
};

/** Render an object schema's properties as editable rows. Tracks one working draft. */
export function SchemaForm({
	schema,
	value,
	onPreview,
	onCommit,
	onCancel,
	onInvalid,
}: SchemaFormProps) {
	// The draft is the live edited copy; re-seed when the committed value changes.
	const [draft, setDraft] = useState<unknown>(value);
	const seed = useRef(value);
	// Echo-guard: track whether any input inside this form currently has focus.
	// While focused, incoming session-updated re-seeds are deferred so an external
	// edit mid-interaction does not clobber the in-progress draft.
	const focusWithin = useRef(false);
	// Per-PATH, deliberately, even though only one refusal leaves this component: a
	// refused draft is never written, so a row stays wrong until its own field is fixed
	// — and clearing it because an UNRELATED ROW was edited would drop the explanation
	// while the bad text is still on screen. The map is the render source; the single
	// slot below is derived from it.
	//
	// A RE-SEED is the one thing that ends a refusal without the field being fixed, and
	// that is `reseed` below rather than an exception to the rule above: once the incoming
	// values are on screen, the text the refusal was about is gone, so keeping it would
	// disable the commit verb while naming a field that now holds a valid number.
	const [refusals, setRefusals] = useState<Record<string, string>>({});

	/** Adopt the incoming value as the draft, dropping any refusal it replaces.
	 *
	 *  The non-empty guard is REQUIRED, not an optimization: this runs during render, and
	 *  an unconditional `setRefusals({})` hands React a fresh object identity every pass,
	 *  which never bails out and loops. */
	const reseed = (next: unknown): void => {
		setDraft(next);
		if (Object.keys(refusals).length > 0) setRefusals({});
	};

	if (seed.current !== value) {
		// Always record that a new value arrived so we know to reseed on blur.
		seed.current = value;
		// Only re-seed immediately when no input is active (shouldReseed returns true).
		// While one IS active the whole re-seed is deferred, refusal included — clearing
		// it here would leave the user's offending text on screen with nothing saying why
		// the commit verb is dead, which is the exact state this channel exists to stop.
		if (draft !== value && shouldReseed(focusWithin.current)) reseed(value);
	}

	const properties = schema.properties ?? {};
	// Schema order, not insertion order: the field a verb names should be the top-most
	// offending one, which is where a reader's eye goes.
	const firstBadPath =
		Object.keys(properties).find((k) => refusals[k] !== undefined) ?? null;
	const firstBadMessage =
		firstBadPath === null ? undefined : refusals[firstBadPath];

	// The upward channel. `report` holds the latest callback so the unmount cleanup can
	// retract without re-running on every prop identity change.
	const report = useRef(onInvalid);
	report.current = onInvalid;
	useEffect(() => {
		report.current?.(
			firstBadPath === null || firstBadMessage === undefined
				? null
				: { path: firstBadPath, message: firstBadMessage },
		);
	}, [firstBadPath, firstBadMessage]);
	useEffect(
		() => () => {
			// The card unmounts this form whenever its palette closes or the record turns
			// read-only. A refusal that outlived it would leave the commit verb disabled
			// with a reason naming a field nothing is rendering.
			report.current?.(null);
		},
		[],
	);

	return (
		<div
			className="flex flex-col gap-1"
			onFocusCapture={() => {
				focusWithin.current = true;
			}}
			onBlurCapture={(e) => {
				// Only clear the flag when focus leaves the form entirely (not when moving
				// between inputs within the form).
				// Boundary cast: relatedTarget is EventTarget | null; DOM guarantees it is
				// a Node when non-null, which is what contains() requires.
				if (!e.currentTarget.contains(e.relatedTarget as Node)) {
					focusWithin.current = false;
					// A session-updated arrived while focused and was deferred — reseed now
					// so the field shows the latest committed value now that editing is done.
					// Through `reseed`, so the deferred case drops its refusal at the same
					// moment the immediate one does; two spellings here is how the fix would
					// come back as "it only happens when you were typing at the time".
					if (draft !== value) reseed(value);
				}
			}}
		>
			{Object.entries(properties).map(([key, fieldSchema]) => {
				const kind = resolveKind(fieldSchema);
				const Renderer = registry[kind] ?? fallbackRenderer;
				const fieldValue = getAtPath(draft, key);
				const refusal = refusals[key];
				/** Record (or clear) this row's refusal and say whether the value may pass. */
				const admits = (next: unknown): boolean => {
					const message = validateNumber(fieldSchema, next);
					setRefusals((prev) => {
						if (prev[key] === (message ?? undefined)) return prev;
						const updated = { ...prev };
						if (message === null) delete updated[key];
						else updated[key] = message;
						return updated;
					});
					return message === null;
				};
				return (
					<RowErrorBoundary key={key} path={key}>
						<Renderer
							schema={fieldSchema}
							value={fieldValue}
							path={key}
							onPreview={(next) => {
								// The refusal is AT the field: nothing is written and nothing is
								// previewed, so the worker never evaluates a ghost the generator
								// is going to throw on.
								if (!admits(next)) return;
								const updated = setAtPath(draft, key, next);
								setDraft(updated);
								onPreview(updated);
							}}
							onCommit={(next) => {
								if (!admits(next)) return;
								const updated = setAtPath(draft, key, next);
								setDraft(updated);
								onCommit(updated);
							}}
							onCancel={() => {
								setDraft(value);
								onCancel();
							}}
						/>
						{refusal !== undefined && (
							// role="alert" so the refusal reaches a screen reader the moment it
							// appears — the visual cue is a red line the user is not looking at
							// while typing.
							<p role="alert" className="pb-0.5 text-2xs text-destructive-text">
								{refusal}
							</p>
						)}
					</RowErrorBoundary>
				);
			})}
		</div>
	);
}
