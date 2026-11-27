# Architecture Lab

Storybook-like visual layer for Ralph Arena architecture projections.

The lab is not a source of runtime, lifecycle, product, or operator truth. The
first story is a visual projection of `docs/project-structure-map.md` and the
canonical contracts in `docs/contracts/` and `docs/ops/`.

## Commands

```bash
npm --prefix apps/architecture-lab run dev
npm --prefix apps/architecture-lab run build
```

## LoopKit

The app includes LoopKit metadata, stable `data-loop-id` anchors, decisions, and
the portable runtime vendored at `public/vendor/loopkit.js`.
