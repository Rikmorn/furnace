import { useEffect, useRef, useState } from "react";
import { commitIfChanged } from "../lib/commit-guard.ts";
import { roundForDisplay } from "../lib/format.ts";
import { isMixed } from "../lib/mixed.ts";
import { scrubValue } from "../lib/scrub.ts";
import type { FieldProps } from "../types.ts";
import { Input } from "../../components/ui/input.tsx";
import { FieldRow, denseNumericInputCls, MIXED } from "./common.tsx";

/** Pixels of horizontal drag per unit change (normal speed). */
const SCRUB_SENSITIVITY = 0.05;

/** Rounding factor: round scrubbed values to 3 decimal places. */
const SCRUB_ROUND = 1000;

export function NumberField({ schema, values, onPreview, onCommit, onCancel, path }: FieldProps) {
  const mixed = isMixed(values);
  const def = typeof schema.default === "number" ? schema.default : 0;
  const initial = mixed
    ? ""
    : String(roundForDisplay(Number((values[0] as number) ?? def)));
  const [text, setText] = useState(initial);
  const focusedRef = useRef(false);
  const scrub = useRef<{ startX: number; startVal: number } | null>(null);
  // The committed numeric value to dirty-check a blur against — held in a ref because
  // `values` tracks the LIVE-PREVIEWED draft while editing (onChange fans a preview that
  // re-renders us with the new value), so comparing to `values[0]` at blur would see the
  // preview, not the pre-edit commit. NaN encodes a mixed selection (always commits a
  // concrete entry). Synced only while UNfocused, so it holds the focus-time value across
  // preview re-renders (same guard as the text re-seed below).
  const committedNum = (): number =>
    mixed ? Number.NaN : roundForDisplay(Number((values[0] as number) ?? def));
  const committedRef = useRef(committedNum());

  // Re-seed when committed values change externally (e.g. SSE / selection change),
  // but never clobber text the user is actively typing.
  useEffect(() => {
    if (!focusedRef.current) {
      setText(initial);
      committedRef.current = committedNum();
    }
  }, [initial]);

  const fanout = (n: number) => values.map(() => n);

  const onScrubDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    const base = Number(text);
    scrub.current = { startX: e.clientX, startVal: Number.isFinite(base) ? base : 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onScrubMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!scrub.current) return;
    const raw = scrubValue(scrub.current.startVal, e.clientX - scrub.current.startX, SCRUB_SENSITIVITY, e.shiftKey);
    const rounded = Math.round(raw * SCRUB_ROUND) / SCRUB_ROUND;
    setText(String(rounded));
    onPreview(fanout(rounded));
  };

  const onScrubUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!scrub.current) return;
    const raw = scrubValue(scrub.current.startVal, e.clientX - scrub.current.startX, SCRUB_SENSITIVITY, e.shiftKey);
    const r = Math.round(raw * SCRUB_ROUND) / SCRUB_ROUND;
    setText(String(r));
    onCommit(fanout(r));
    scrub.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <FieldRow path={path} labelPointerProps={{ onPointerDown: onScrubDown, onPointerMove: onScrubMove, onPointerUp: onScrubUp, onPointerCancel: onScrubUp }}>
      <Input
        className={denseNumericInputCls}
        inputMode="decimal"
        placeholder={mixed ? MIXED : undefined}
        value={text}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n)) onPreview(fanout(n));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Do NOT call onCommit here — blur fires onBlur which is the sole committer.
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            onCancel();
            setText(initial);
          }
        }}
        onBlur={() => {
          focusedRef.current = false;
          const n = Number(text);
          if (text.trim() === "" || !Number.isFinite(n)) {
            setText(initial);
            return;
          }
          // Dirty check (shared with Vec/Quat): commit only when the value actually
          // changed vs the committed baseline, so a focus+blur (or re-typing the same
          // value) never fires a spurious no-op commit / revision bump.
          commitIfChanged(committedRef.current, n, () => onCommit(fanout(n)));
        }}
      />
    </FieldRow>
  );
}
