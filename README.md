# graphed-debug

Debugging for **graphed** (milestone M6): opt-level lowering, source-mapped **picklable** tracebacks,
and visualization.

The headline guarantee (plan A.3 #8): a runtime error — even one raised deep inside a fused stage on a
remote worker **process** — is re-raised in the driver as a `StageError` whose `format_traceback`
points at the **user's analysis line**, never a raw opaque worker traceback.

- `lower(session, array, opt_level=...)` — `0` is a 1:1 op↔node lowering with inter-op assertions;
  `>=1` fuses maximal op-runs between boundaries.
- `StageError` — carries the failing op, the user source-frame chain, input forms, and the partition;
  **picklable**, so it round-trips intact across a process boundary.
- `format_traceback(err)` — collapses `graphed*` frames, shows the user's analysis line.
- `visualize(lowered, fmt=...)` — Graphviz/Mermaid annotated with provenance + projected columns.

Defers to the root `graphed-project/CLAUDE.md`; the project plan always wins.
