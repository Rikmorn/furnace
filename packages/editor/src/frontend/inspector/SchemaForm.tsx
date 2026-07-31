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
				<p className="py-1 font-mono text-xs text-destructive">
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
	schema: JsonSchemaNode; // an object schema (component / settings / resource params)
	values: unknown[]; // N target params objects (one per selected entity)
	onPreview: (next: unknown[]) => void;
	onCommit: (next: unknown[]) => void;
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

/** Why `next` is inadmissible under `schema`, or `null`. All N targets are checked: a
 *  multi-select fans one value to every target, so one bad entry poisons the whole
 *  commit. */
function refuse(schema: JsonSchemaNode, next: unknown[]): string | null {
	for (const value of next) {
		const message = validateNumber(schema, value);
		if (message !== null) return message;
	}
	return null;
}

/** Render an object schema's properties as editable rows. Tracks N working drafts. */
export function SchemaForm({
	schema,
	values,
	onPreview,
	onCommit,
	onCancel,
	onInvalid,
}: SchemaFormProps) {
	// Drafts are the live edited copies; re-seed when the committed values change.
	const [drafts, setDrafts] = useState<unknown[]>(values);
	const seed = useRef(values);
	// Echo-guard: track whether any input inside this form currently has focus.
	// While focused, incoming session-updated re-seeds are deferred so an external
	// edit mid-interaction does not clobber the in-progress draft.
	const focusWithin = useRef(false);
	// Per-PATH, deliberately, even though only one refusal leaves this component: a
	// refused draft is never written, so a row stays wrong until its own field is fixed
	// — and clearing it because an unrelated row was edited would drop the explanation
	// while the bad text is still on screen. The map is the render source; the single
	// slot below is derived from it.
	const [refusals, setRefusals] = useState<Record<string, string>>({});

	if (seed.current !== values) {
		// Always record that a new value arrived so we know to reseed on blur.
		seed.current = values;
		// Only re-seed immediately when no input is active (shouldReseed returns true).
		if (drafts !== values && shouldReseed(focusWithin.current))
			setDrafts(values);
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
					if (drafts !== values) setDrafts(values);
				}
			}}
		>
			{Object.entries(properties).map(([key, fieldSchema]) => {
				const kind = resolveKind(fieldSchema);
				const Renderer = registry[kind] ?? fallbackRenderer;
				const fieldValues = drafts.map((d) => getAtPath(d, key));
				const refusal = refusals[key];
				/** Record (or clear) this row's refusal and say whether the value may pass. */
				const admits = (next: unknown[]): boolean => {
					const message = refuse(fieldSchema, next);
					setRefusals((prev) => {
						if (prev[key] === (message ?? undefined)) return prev;
						const updated = { ...prev };
						if (message === null) delete updated[key];
						else updated[key] = message;
						return updated;
					});
					return message === null;
				};
				const fan = (next: unknown[]) =>
					drafts.map((d, i) => setAtPath(d, key, next[i]));
				return (
					<RowErrorBoundary key={key} path={key}>
						<Renderer
							schema={fieldSchema}
							values={fieldValues}
							path={key}
							onPreview={(next) => {
								// The refusal is AT the field: nothing is written and nothing is
								// previewed, so the worker never evaluates a ghost the generator
								// is going to throw on.
								if (!admits(next)) return;
								const updated = fan(next);
								setDrafts(updated);
								onPreview(updated);
							}}
							onCommit={(next) => {
								if (!admits(next)) return;
								const updated = fan(next);
								setDrafts(updated);
								onCommit(updated);
							}}
							onCancel={() => {
								setDrafts(values);
								onCancel();
							}}
						/>
						{refusal !== undefined && (
							// role="alert" so the refusal reaches a screen reader the moment it
							// appears — the visual cue is a red line the user is not looking at
							// while typing.
							<p role="alert" className="pb-0.5 text-[10px] text-destructive">
								{refusal}
							</p>
						)}
					</RowErrorBoundary>
				);
			})}
		</div>
	);
}
