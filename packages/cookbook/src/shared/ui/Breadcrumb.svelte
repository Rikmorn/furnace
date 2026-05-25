<script lang="ts">
  type Props = { slug: string };
  let { slug }: Props = $props();
</script>

<nav class="breadcrumb">
  <a href="/">← cookbook</a>
  <span class="sep">/</span>
  <span class="slug">{slug}</span>
</nav>

<style>
  .breadcrumb {
    position: fixed;
    top: var(--space-4);
    left: var(--space-4);
    z-index: 10;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--surface) 90%, transparent);
    backdrop-filter: var(--blur);
    -webkit-backdrop-filter: var(--blur);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .breadcrumb a {
    color: var(--text);
  }
  .breadcrumb a:hover {
    color: var(--accent);
  }
  .sep { color: var(--text-dim); }
  .slug { color: var(--accent); }
</style>
