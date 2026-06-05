# CLAUDE.md — graphed-debug

Defers to the root **`graphed-project/CLAUDE.md`**; the **project plan
(`graphed-project-plan-gated.md`) always wins.** This file distills **milestone M6**.

## What this repo is

`graphed-debug`: opt-level lowering, **source-mapped picklable tracebacks**, and visualization. It
turns the IR + the M3 provenance into human-readable debugging output, and guarantees that a runtime
error maps to the user's analysis line **even across a process boundary** (plan A.3 #8).

> Guardrail (M6): **no interactive debugger / time-travel replay** (Phase 2). Lowering + traceback
> surfacing + visualization only.

## Implemented (M6)

- `lower(session, array, opt_level)` — `opt_level=0` is **1:1 op↔node** (no fusion) + inter-op
  consistency assertions; `>=1` fuses maximal op-runs between boundaries (the M4 boundary rule). Each
  op keeps its exact provenance, so an error maps to the same analysis line at any opt level.
- `StageError` (`errors.py`) — failing op + **user source-frame chain** + input forms + partition,
  all plain data; custom `__reduce__`/`__setstate__` make it **picklable** so it round-trips intact
  from a remote worker (it never degrades to an opaque string; it carries no un-picklable traceback).
- `run(session, array, opt_level=...)` — a debug runner that executes op-by-op (localizing a failure
  even deep inside a fused stage) and raises a mapped `StageError`.
- `format_traceback(err)` (`tracebacks.py`) — collapses `graphed*` frames; renders the user frames,
  failing line last/marked. Identical before and after a pickle round-trip.
- `visualize(lowered, fmt="mermaid"|"graphviz", projection=...)` (`viz.py`) — deterministic source
  text, annotated with provenance + (optionally) M5 projected columns.

## Dependencies / gates

Runtime: `graphed` (frontend: `walk`, `provenance`, `source_value`) + `graphed-core`. Tests also use
`graphed-numpy` / `graphed-awkward` / `graphed-corpus` for realistic analyses. Gates: `ruff` +
`ruff format` · `mypy --strict` · `pytest tests/frozen --cov=graphed_debug` (≥90%) · `sphinx -W`.

Status: see `.graphed/state.json`.
