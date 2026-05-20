# Camera + projection matrices for in-scene primitives

Both the triangle and the WGSL UI plane currently render in NDC space — no view, no projection. Once we need to position content in world space (which is approximately when ECS lands and entities have transforms), we need a camera with view/projection matrices and a uniform buffer pattern shared across pipelines.

**Trigger to revisit:** First surface needing world-space positioning, typically aligned with ECS arrival.
