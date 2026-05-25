<script lang="ts">
  type Anchor = "top-left" | "top-right" | "bottom-left" | "bottom-right";

  type Props = {
    title: string;
    keyHint?: string;          // e.g., "s" for stats
    anchor: Anchor;
    storageKey: string;        // unique key for collapsed-state persistence
    defaultOpen?: boolean;
    children?: import("svelte").Snippet;
  };

  let { title, keyHint, anchor, storageKey, defaultOpen = true, children }: Props = $props();

  // Persistence: stored as "1" (open) / "0" (collapsed). Missing = use defaultOpen.
  function readInitial(): boolean {
    if (typeof sessionStorage === "undefined") return defaultOpen;
    const v = sessionStorage.getItem(storageKey);
    if (v === null) return defaultOpen;
    return v === "1";
  }

  let open = $state(readInitial());

  function toggle() {
    open = !open;
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(storageKey, open ? "1" : "0");
    }
  }

  // Keyboard shortcut handling
  $effect(() => {
    if (!keyHint) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't collide with browser/OS chord shortcuts (Cmd+S, Ctrl+S, Alt+…)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Don't intercept if user is typing in an input
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      )
        return;
      if (e.key.toLowerCase() === keyHint.toLowerCase()) {
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
</script>

<aside class="panel" data-anchor={anchor} data-open={open}>
  <button class="bar" type="button" onclick={toggle}>
    <span class="title">{title}</span>
    {#if keyHint}
      <span class="key">[{keyHint}]</span>
    {/if}
    <span class="caret">{open ? "▾" : "▴"}</span>
  </button>
  {#if open}
    <div class="body">
      {@render children?.()}
    </div>
  {/if}
</aside>

<style>
  .panel {
    position: fixed;
    z-index: 10;
    background: color-mix(in srgb, var(--surface) 90%, transparent);
    backdrop-filter: var(--blur);
    -webkit-backdrop-filter: var(--blur);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    min-width: 200px;
    max-width: 340px;
    color: var(--text);
    transition: opacity 150ms;
  }
  .panel[data-anchor="top-left"]     { top: var(--space-4); left: var(--space-4); }
  .panel[data-anchor="top-right"]    { top: var(--space-4); right: var(--space-4); }
  .panel[data-anchor="bottom-left"]  { bottom: var(--space-4); left: var(--space-4); }
  .panel[data-anchor="bottom-right"] { bottom: var(--space-4); right: var(--space-4); }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: none;
    color: var(--text);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: left;
  }
  .bar:hover { background: var(--surface-hover); }

  .title { flex: 1; }

  .key {
    color: var(--text-muted);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1px 6px;
    font-size: 10px;
  }

  .caret {
    color: var(--text-dim);
    font-size: 14px;
    line-height: 1;
  }

  .body {
    padding: var(--space-3);
    border-top: 1px solid var(--border);
    font-size: 12px;
    line-height: 1.5;
  }
</style>
