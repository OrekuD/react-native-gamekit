# Retained sprites and Atlas sprite batches

## Purpose and verdict

Draw small sprite populations conveniently and larger shared-texture populations in bounded Atlas buffers. **Keep both render modes. Repair transform composition and native buffer publication before evaluating throughput.**

Sources: [Sprite.tsx](../../packages/gamekit/src/react/sprites/Sprite.tsx), [spriteTransform.ts](../../packages/gamekit/src/react/sprites/spriteTransform.ts), [GameSprite.tsx](../../packages/gamekit/src/react/sprites/GameSprite.tsx), [SpriteBatch.tsx](../../packages/gamekit/src/react/sprites/SpriteBatch.tsx), [batch policy](../../packages/gamekit/src/react/sprites/spriteBatchPolicy.ts).

## GS-SPRITE-01 — P1: retained scale/flip transforms move the anchor and fail to react

**Evidence: scalar reproduction plus source-confirmed component wiring.** `computeSpriteRsxform` puts the anchor at world `(x,y)`. An outer Group then scales/flips around the **local frame pivot**, transforming the already-world-positioned result. For a 20×20 frame, centered anchor, `(x,y)=(100,100)`, and scale 2, the composed anchor becomes `(190,190)` instead of `(100,100)`. The Group correction is calculated in React `useMemo`, reads SharedValues during render, and has no scale/flip dependencies. Shared scale/flip changes therefore do not update it; static prop changes with the same frame/anchor can also stay stale.

**Resolve:** derive one correct transform model from the invariant that the anchor maps to `(x,y)` under every scale, rotation, and flip. Apply local scale/flip before rotation and world placement, or use a mathematically equivalent complete transform. Keep all dynamic values in worklet-derived outputs, not React memo evaluation. Prefer encoding uniform scale in RSXform and isolating reflection only where needed. Verify actual Skia composition order; do not fix this by moving game coordinates.

**Acceptance:** transform all four corners and the anchor for nonzero world position, noncentral anchor, rotation, scale 0/0.5/2, each flip, and shared/static prop replacement. The anchor is invariant. A native screenshot/interaction check confirms the algebra matches Skia.

## GS-SPRITE-02 — P1: SpriteBatch ignores its per-item scale

**Evidence: reproduced in the shared helper and confirmed in the batch call site.** Batch `writeApi.set` passes `scale` to `computeSpriteRsxform`, but that function never reads it. The retained Sprite has an outer correction; SpriteBatch has no such Group. `scos/ssin` remain unit rotation for scale 2.

**Resolve:** correct the batch RSXform to include uniform scale in its matrix and pivot compensation. Share the correct scalar transform with retained sprites where possible, without reintroducing a per-item Group. Preserve deterministic slot/draw order and existing anchors.

**Acceptance:** the actual batch setter writes scaled coefficients and correctly compensated translation, including zero scale and changing frame dimensions. Test nonzero rotation so a translation-only implementation cannot pass.

## GS-SPRITE-03 — P2: direct clip playback uses stale frame dimensions for anchors

**Evidence: source-confirmed.** Sprite's rect worklet resolves `clip + elapsedMs`, but its xform worklet only checks explicit `frame`. Without an explicit frame, it retains the baseline dimensions from `resolveSpriteFrameRect`. A clip with differently sized frames draws changing rectangles around the wrong pivot. The Group correction also uses baseline dimensions.

**Resolve:** resolve frame name/rectangle once into a coherent presentation selection shared by rect and transform computation. Reuse [animation](10-sprite-animation.md)'s sampler. Do not silently require equal-size frames unless that restriction is added to the public definition contract and validated.

**Acceptance:** a clip alternates between differently sized frames with a centered anchor; its world anchor stays fixed. Explicit frame precedence and absent selection still behave intentionally.

## GS-SPRITE-04 — P2: delete unreachable overflow work and unsupported allocation claims

**Evidence: source-confirmed.** On production overflow, a loop iterates from `capacity` to `items.length` looking for slots in a capacity-sized buffer. Every slot is absent; the loop adds unbounded work without hiding anything. Per visible item, the batch creates an input object and `computeSpriteRsxform` creates a result object, despite “no per-frame allocation” comments. Tail clearing also scans all unused capacity every update.

**Resolve:** delete the overflow loop; `activeCount = min(items.length, capacity)` already expresses the policy. Correct allocation comments. Only introduce scalar writers or track the prior active range after a benchmark shows a benefit. Validate write indices as integers if retaining the author-exposed indexed writer. Consider a simpler per-slot mapper only if it removes real misuse without reducing necessary expressiveness.

**Acceptance:** very large production item arrays visit at most capacity writable slots; development overflow remains explicit. Shrink/scene mismatch clears old slots. Reuse tests for culling and stable topology.

## Native and performance gates

[GS-REACT-03](03-react-presentation.md) owns native buffer-notification verification for this system, tilemaps, and particles. Keep React topology stable and images borrowed from leases. Measure 100/500/1000 sprites, active versus allocated capacity, visible fraction, transformed frames, and memory on 60/120 Hz devices. Culling hides draw slots but still scans selected items and tail capacity; it is not proof of visible-only CPU work. Preserve the existing transform/batch/commit tests while replacing tests that only mirror the faulty helper.
