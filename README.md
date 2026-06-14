<div align="center">

<img src="./public/favicon.svg" width="72" alt="Collision Pipeline mark" />

# Collision Pipeline

**An interactive broad-phase collision detection case study**

[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-1f7a65?style=flat-square)](./LICENSE)

Compare brute force, spatial hashing, and sweep-and-prune on the same dynamic circle simulation. Inspect the complete path from possible pairs to exact contacts and measured physical response.

</div>

## Why This Exists

Collision detection is a pipeline, not a single overlap test. With `n` bodies there are `n(n - 1) / 2` possible pairs, so testing every pair quickly becomes the dominant cost.

The broad phase reduces that search space. It may return false positives, but it must not omit a real collision. This demo makes that contract visible and verifies it against an all-pairs oracle.

## What The Demo Shows

| Stage | Responsibility | Measured output |
| --- | --- | --- |
| Broad phase | Conservatively propose potentially overlapping pairs | Candidates, duration, method-specific work |
| Narrow phase | Run exact circle-circle tests | Contacts, false positives, duration |
| Response | Correct penetration and apply restitution impulses | Applied impulses, duration |
| Audit | Compare broad-phase output with brute-force truth | Contact recall, missed contacts |

## Broad-Phase Methods

### Brute Force

Emits every unique pair. It is simple, correct, and useful as the audit oracle, but candidate growth is quadratic.

### Spatial Hash

Inserts every circle into all fixed-grid cells touched by its axis-aligned bounding box, not just the center cell. Shared-cell pairs are deduplicated before narrow-phase testing.

This works especially well for similarly sized objects distributed across space. Dense buckets, poor cell sizing, and giant objects spanning many cells expose its limits.

### Sweep And Prune

Sweep-and-prune is strongest when motion is coherent and at least one projection separates most bounds. It loses efficiency when many intervals overlap, when objects teleport or reorder rapidly, or when the active set becomes broad enough that pair work approaches quadratic behavior.

This educational implementation sorts one axis, X, and applies Y as a secondary AABB filter before exact circle tests. That is an implementation note rather than the general limitation of sweep-and-prune; production variants may choose an axis dynamically or maintain multiple axes.

Interval order is retained between live frames and repaired with insertion sort. A full sort occurs only when the interval set is initialized or reset.

Candidate counts are not perfectly symmetric across methods. Spatial hash candidates are deduplicated pairs that shared at least one cell, while sweep-and-prune candidates have already passed both X and Y AABB overlap tests. The UI therefore reports broad pair checks separately from emitted candidates, and reports sweep ordering swaps separately. The same-snapshot benchmark includes sweep-and-prune's cold-start sort; live telemetry shows its warm-frame behavior.

The **Key insight** panel translates those counters into method-specific signals:

- Spatial hash shows cell entries per body and bucket checks per emitted candidate, making poor cell sizing visible.
- Sweep-and-prune shows rolling order repairs and X-overlap checks per body. Exponential smoothing plus state hysteresis keeps the explanation stable while still exposing sustained ordering churn or a growing active set.
- Brute force shows that it advances 100% of theoretical pairs regardless of distribution.

## Scenario Matrix

| Scenario | What it stresses |
| --- | --- |
| Uniform small bodies | Friendly baseline for spatial partitioning |
| Dense clusters | High local occupancy and many legitimate candidates |
| Horizontal lanes | One-axis projection quality and temporal coherence |
| Mixed body sizes | Multi-cell insertion and tuning sensitivity |
| Giant bodies | Duplicate hash work from objects spanning many cells |
| High-speed CCD crossing | Opposing pairs move farther than their diameter between frames |

Use **Compare all methods** to freeze one snapshot and run each method against identical data. Use **Audit contact recall** to verify the selected method has not missed a contact.

The live **Wins when / Loses when / Read this frame** strip keeps those tradeoffs in the demo itself. The **Live method race** reruns spatial hash and sweep-and-prune on the same current world at 5 Hz, showing rolling broad-phase time, candidates, internal checks, and the shared exact-contact result independently of FPS.

## Run Locally

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

Type-check without emitting files:

```bash
npm run check
```

Run the test suite:

```bash
npm test
```

## Tests

The case study claims audited correctness, so that claim is itself tested. [Vitest](https://vitest.dev/) covers the pieces the demo measures:

- `pairBuffer` — flat storage growth and integrity across reallocation.
- `naive` — emits exactly `n(n - 1) / 2` unique ascending pairs.
- `spatialHash` / `sweepAndPrune` — recall against the oracle, deduplication, multi-cell insertion, and sweep temporal coherence (cold full sort once, then insertion-sort repair).
- `collision` — exact circle tests, touching-but-not-overlapping boundaries, impulse direction, and momentum conservation.
- `continuous` — swept time-of-impact roots and tunneling clamp.
- `world` — deterministic seeded scenarios and wall reflection.
- `recall.invariant` — **the central contract**: every broad phase keeps 100% recall against the brute-force oracle across every scenario, body count, and many simulated frames.
- `app.mount` — mounts against a stubbed canvas and drives one frame, guarding the wiring between markup and code.

## Controls

- Change body count, motion speed, restitution, scenario, and spatial-hash cell size.
- Switch methods with the UI or keys `1`, `2`, and `3`.
- Press `Space` to pause the simulation.
- Toggle candidate lines, exact contact normals, short motion ticks, response, continuous detection, and the spatial grid.
- Set the generated body count to zero and build a workload directly on the canvas.
- **Launch** a body by dragging its velocity vector, **Dynamic spray** dense moving clusters, paint **Static wall** chains into funnels or pockets, and **Erase** any region.
- Change body/brush size and clear only user-created geometry without resetting the base scenario.
- Run the **CCD challenge** to load 48 deterministic opposing pairs whose paths cross entirely between sampled frames.
- Add 250 bodies at a time with the stress control, up to 2,000.

Candidate lines are sampled when their count becomes too large to draw legibly. The canvas reports exactly how many of the total lines are shown instead of silently hiding the overlay.

## Reading The Results

Four views turn the raw counters into lessons:

- **Live method race** keeps spatial hash and sweep-and-prune beside the workload-building tools, so edits to density, geometry, and motion immediately change their rolling cost and internal work.
- **Measured stages** splits telemetry into a *Correctness* group (recall, missed contacts, false positives and rate, tunneling saves) and a *Performance* group (stage timings and method-specific work), so quality and cost never get confused.
- **Scaling behavior** plots broad-phase time against body count from 100 to 2,000 on fresh snapshots of the current scenario. Brute force traces an n² curve while the partitioned methods stay far flatter.
- **Side-by-side** animates the live simulation through two chosen broad phases at once. Each panel reports candidates, exact contacts, useful-pair percentage, and duration; a live verdict states which method forwarded fewer pairs on that frame.

## Continuous Detection (CCD)

Discrete detection inspects only the current frame, so a body moving more than its own radius per frame can pass through another between samples. Enabling **Continuous (CCD)** addresses both halves of that failure:

- Broad phase inflates each body's AABB to span its full frame of motion, so a fast pair is still proposed instead of being pruned.
- A swept circle-circle test solves for time of impact, orders candidate impacts chronologically, and clamps each body to its earliest crossing before handing the contact to the same impulse solver.
- The canvas draws swept paths in gold, rings recovered bodies, and keeps a cumulative **CCD saves this run** count so a successful recovery remains visible after the impact frame.

## Implementation Notes

- The simulation uses deterministic seeded scenarios for repeatable resets.
- User-created bodies share the same pipeline as generated bodies; static brush bodies use zero inverse mass and remain fixed during impulse response.
- Candidate pairs live in reusable flat `Int32Array` storage to avoid allocating one object per pair.
- Spatial hashing inserts full circle AABBs rather than only center points.
- Shared-cell hash pairs are deduplicated before narrow-phase testing.
- Sweep-and-prune preserves its previous X ordering and uses insertion sort on subsequent live frames.
- The renderer clears the canvas every frame and uses body outlines plus short per-frame motion ticks rather than accumulated trails.
- Dense candidate overlays use deterministic line sampling to preserve structure without turning the canvas into an opaque web.
- Position correction is weighted by inverse mass.
- Restitution impulses are applied only when bodies are moving toward one another.
- Audit work is measured separately and does not contaminate live pipeline timings.

## Project Structure

```text
src/
├── broadphase/
│   ├── naive.ts
│   ├── pairBuffer.ts
│   ├── spatialHash.ts
│   └── sweepAndPrune.ts
├── physics/
│   ├── collision.ts
│   ├── continuous.ts        # swept time-of-impact for CCD
│   ├── types.ts
│   └── world.ts
├── test/
│   ├── oracle.ts            # shared recall/correctness helpers
│   └── recall.invariant.test.ts
├── app.ts
├── main.ts
└── style.css
```

Unit tests live next to the code they cover as `*.test.ts`, with cross-cutting suites under `src/test/`.

## Deployment

This is a static Vite application. For Coolify or another static host:

| Setting | Value |
| --- | --- |
| Build pack | Nixpacks |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Static site | Enabled |

No server process or start command is required for the production deployment.

## Scope And Limitations

This study uses circles, a single response pass, and one-axis X sweep-and-prune. Detection is discrete by default, so sufficiently fast bodies can tunnel between frames. The optional continuous mode adds swept broad-phase bounds and an earliest-impact narrow test; the recall audit still verifies current-frame overlaps only.

A production physics engine would go further: shape-specific narrow phases beyond circles, multiple CCD events per body per frame, sub-stepping, persistent manifolds, sleeping, solver iterations, and adaptive broad-phase structures. Supporting rectangles and other shapes is the most natural next step, since broad-phase behavior shifts once bounds are no longer derived from a single radius.

Those omissions keep this case study focused on the contract and tradeoffs of broad-phase candidate generation.

## License

[MIT](./LICENSE)
