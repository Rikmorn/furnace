---
summary: the WebGPU swap chain is not recreated on native window resize, so the render is squished
---

# Window resize → swap chain recreation

Triangle is squished on window resize because the WebGPU canvas swap chain isn't recreated. Acceptable for one static triangle, embarrassing the moment we render anything else.

**Trigger to revisit:** When a second example is added, or when the squish becomes annoying enough to fix.
