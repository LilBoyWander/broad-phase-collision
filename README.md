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
| Broad phase | Conservatively propose potentially overlapping pairs | Candidates, duration, internal checks |
| Narrow phase | Run exact circle-circle tests | Contacts, false positives, duration |
| Response | Correct penetration and apply restitution impulses | Applied impulses, duration |
| Audit | Compare broad-phase output with brute-force truth | Contact recall, missed contacts |

The original single-file experiments are preserved in [`prototype/`](./prototype/).

## Broad-Phase Methods

### Brute Force

Emits every unique pair. It is simple, correct, and useful as the audit oracle, but candidate growth is quadratic.

### Spatial Hash

Inserts every circle into all fixed-grid cells touched by its axis-aligned bounding box. Shared-cell pairs are deduplicated before narrow-phase testing.

This works especially well for similarly sized objects distributed across space. Dense buckets, poor cell sizing, and giant objects spanning many cells expose its limits.

### Sweep And Prune

Sorts body intervals along the X axis and only considers overlapping projections. A Y-axis AABB test further reduces candidates before exact circle tests.

Interval order is retained between frames, allowing insertion sort to benefit from temporal coherence. Horizontal crowding weakens the chosen axis.

## Scenario Matrix

| Scenario | What it stresses |
| --- | --- |
| Uniform small bodies | Friendly baseline for spatial partitioning |
| Dense clusters | High local occupancy and many legitimate candidates |
| Horizontal lanes | One-axis projection quality and temporal coherence |
| Mixed body sizes | Multi-cell insertion and tuning sensitivity |
| Giant bodies | Duplicate hash work from objects spanning many cells |

Use **Compare all methods** to freeze one snapshot and run each method against identical data. Use **Audit contact recall** to verify the selected method has not missed a contact.

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

## Controls

- Change body count, motion speed, restitution, scenario, and spatial-hash cell size.
- Switch methods with the UI or keys `1`, `2`, and `3`.
- Press `Space` to pause the simulation.
- Toggle candidate lines, exact contact normals, response, and the spatial grid.
- Add 250 bodies at a time with the stress control, up to 2,000.

Candidate lines are intentionally hidden when their count becomes too large to remain useful.

## Implementation Notes

- The simulation uses deterministic seeded scenarios for repeatable resets.
- Candidate pairs live in reusable flat `Int32Array` storage to avoid allocating one object per pair.
- Spatial hashing inserts full circle AABBs rather than only center points.
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
│   ├── types.ts
│   └── world.ts
├── app.ts
├── main.ts
└── style.css
prototype/
├── broad-phase-collision-v1.html
└── broad-phase-collision-v2.html
```

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

This study intentionally uses circles, discrete collision detection, a single response pass, and one-axis sweep-and-prune. A production physics engine may add shape-specific narrow phases, continuous collision detection, persistent manifolds, sleeping, solver iterations, and adaptive broad-phase structures.

Those omissions keep this case study focused on the contract and tradeoffs of broad-phase candidate generation.

## License

[MIT](./LICENSE)
