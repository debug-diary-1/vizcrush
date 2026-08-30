# deck.gl density level of detail

This example uses `bin2dWithBackend` from `@vizcrush/bin` to reduce one million positions to a bounded set of non-empty density cells. A deck.gl `GridCellLayer` renders those cells with a Cartesian, increasing-Y-up orthographic view.

deck.gl already provides high-performance rendering and binary-data paths. This example focuses on a different boundary: aggregating source data into a selectable density level of detail before constructing render objects. The UI reports the actual vizcrush backend and a warm local binning time after one untimed call on the real input.

```bash
pnpm --dir examples/deckgl-density-lod dev
```
