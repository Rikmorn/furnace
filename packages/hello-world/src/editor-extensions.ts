import { defineComponent, z } from "@furnace/core/scene";

// hello-world's editor extension: a pure-data annotation component. Proves the
// Branch-A wire in the dogfood — the editor only knows it via this import.
defineComponent("editorNote", {
  params: { text: z.string() },
});
