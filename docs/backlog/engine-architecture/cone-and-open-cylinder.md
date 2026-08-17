---
summary: `geometry.cylinder` is single-radius and always capped; `radiusTop ≠ radiusBottom` (cone/frustum) and an `openEnded` toggle are the two shapes engines commonly also expose
---

# Cone + open-ended cylinder

## Context
`geometry.cylinder` (Stage 3) is single-radius and always capped. Engines commonly
also expose `radiusTop ≠ radiusBottom` (cone/frustum) and an `openEnded`/`capped`
toggle (open tube). Deferred — bowling pins are capped solids.

## Trigger to revisit
A demo needs a cone/funnel/frustum or an open tube.

## Reference
Physics Stage 3 (render shapes) design §1 OUT.
