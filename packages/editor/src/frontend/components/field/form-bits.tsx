// The native-<select> class string, and nothing else since F4.5c Task 8 moved the tooltip
// trio to `components/tips.tsx`. Two consumers (the session card's advanced section and
// the tool strip's params row). Stateless.
//
// The `field/` address is historical rather than descriptive: the panel's own pieces that
// used to be the callers (BrushInspector, StampInspector) were both deleted, and both
// surviving consumers are shell surfaces.
//
// These panels use the NATIVE <select>, not the package's ui/select.tsx (Radix) — a
// deliberate deviation from the primitive four other files use. The selects here are
// dense, list-driven knob rows where the platform's own keyboard and mobile-wheel
// behaviour is exactly what we want, and a native control stays drivable from the chrome
// harness with fireEvent.change. Radix's portaled listbox buys nothing at this size and
// costs the harness a mock.

export const SELECT_CLASS =
	"h-8 rounded-md border border-input bg-transparent px-2";
