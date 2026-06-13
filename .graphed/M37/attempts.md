# M37 — live execution dashboard: attempts log

Decomposition: `.graphed/M37/decompose.md`. Cross-repo: graphed-core (seam), graphed-exec-local
(emit), graphed-debug (consume + render). Landed first as an unfrozen spike to validate the seam,
then froze the acceptance suites (per user direction).

## Spike (unfrozen) — validated end-to-end
- Added the data-only seam to `graphed_core.execution`: `TaskPhase`, `TaskEvent`, `Monitor`,
  `WorkerProfiler`, `emit_task`, `partition_label`; wired `SequentialRunner(monitor=)`.
- Emit in `graphed-exec-local`: driver-side SUBMITTED + worker-side STARTED/FINISHED/ERRORED;
  threads emit in-process, processes forward over a bounded `Manager().Queue()` drained by a
  driver-side collector daemon thread. Refactored `_prepare` → `_raw_submit` + a SUBMITTED-emitting
  wrapper; `_combine_cb` folds the legacy `on_combine` hook and the monitor.
- `graphed-debug`: `Dashboard` (Monitor + `ThreadingHTTPServer` daemon thread, SSE, ring buffers,
  static SPA) and `_sampler.py` (pyinstrument-backed `WorkerProfiler`, session combine, flamegraph
  adapter). Vendored uPlot + d3 + d3-flame-graph under `static/`.
- Spike script ran Thread + Process executors with a live `Dashboard(profile=True)`: result ==
  baseline (passive), `/`, `/api/state.json`, `/static/*` all 200, SSE streamed snapshot + 62 stat
  + 16 flame frames, merged flamegraph non-empty, both executors' workers observed.
- Fix: pyinstrument's sampler timer outlived worker processes ("`NoneType` object is not callable"
  at interpreter teardown) → registered an `atexit` that stops every started profiler. Clean after.

## Freeze + implement (green)
- Frozen suites: core `tests/frozen/m37` (seam shape, sequential emit, passivity, raising-monitor);
  exec-local `tests/frozen/m37` (emit Thread+Process, passivity, errored, best-effort, + the
  ProcessExecutor×Dashboard cross-process capstone); debug `tests/frozen/m37` (monitor, profile
  merge, SSE + routes + traversal guard, opt-in lifecycle, error panel, flame adapter).
- Gates: ruff + ruff format clean (3 repos); `mypy --strict` clean (3 repos; exec-local gained a
  `graphed_debug.*` ignore-missing-imports override — no py.typed); coverage — debug new files
  dashboard.py 95% / _sampler.py 95%, repo total 96%; `sphinx -W` clean.
- Passivity (the determinism obligation) frozen-tested in all three repos: monitor vs no-monitor →
  identical `value` + `n_combines`; `profile=True` capstone leaves the result unchanged.
- Regression check: existing frozen suites green in all three repos; downstream consumers (graphed,
  graphed-preserve, graphed-checkpoint) green; whole-stack import smoke OK.

Root prompt: **R20** (live execution dashboard) added. Docs: design.rst "Live execution dashboard"
section + improvements.rst Phase-2 entries.

Pending (orchestration, on user direction): freeze tag `freeze-M37-0`, `.graphed/state.json` +
bookkeep, reviewer APPROVE, commit + push.
