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

## REVISION (2026-06-13) — redone with FINOS Perspective + websockets + network transport

Per user direction ("redo using FINOS Perspective, with websockets and network comms transport ...
something more fully fledged"), the SSE/uPlot implementation was **backed up** to the
`m37-sse-uplot` branch in each repo and main was rebuilt:

- The data-only core seam (graphed-core `TaskEvent`/`Monitor`/`WorkerProfiler`) is **unchanged** —
  it is transport/render-agnostic, so a `NetworkMonitor` is just another `Monitor`. graphed-core
  main stays at the M37 seam commit (freeze-M37-0).
- graphed-debug: removed the SSE `Dashboard` + static SPA (uPlot/d3); added a `dashboard/` package —
  `DashboardServer` (perspective `Server` + Tornado: `/websocket` viewer, `/ingest` event websocket,
  index page; IOLoop in a daemon thread), `NetworkMonitor` (passive `Monitor` streaming events to a
  server over a websocket — loopback or remote; the network-comms transport), `Dashboard`
  (server + loopback client), `_wire` (schemas), `_sampler.profile_rows` (session -> tabular rows).
  Browser renders three live Perspective tables (tasks/profile/stats).
- graphed-exec-local: executors **unchanged** (any `Monitor` works); capstone rewritten to stream a
  real `ProcessExecutor` run over the websocket to the server; added `test_inprocess_paths.py` to
  cover the worker/profiler emit code in-process (the pre-existing CI coverage gap).
- Deps (graphed-debug `dashboard` extra): perspective-python, tornado, websocket-client,
  pyinstrument. perspective ships cp311-abi3 wheels (install on 3.11-3.14, not 3.14t), so the
  dashboard tests `importorskip` and CI installs `.[dev,dashboard]` on the blocking legs.
- Validated end-to-end locally: both executors stream over a loopback websocket into Perspective
  tables; passive (result == baseline); profile rows traverse the network. Coverage: graphed-debug
  93%, graphed-exec-local 96% (capstone-skipped, CI-equivalent).
- Re-frozen `freeze-M37-1` (debug + exec-local; the SSE suite was deleted/replaced — a sanctioned
  redo, integrity-scan's `assertion_removed` on the deletions is that sanction). The SSE suite lives
  on `m37-sse-uplot`.

## REVISION (2026-06-15) — profiler: pyinstrument -> off-thread sys._current_frames sampler

Per user direction (after measuring a profiling penalty on the real ADL benchmark). Root cause: the
`WorkerProfiler` was pyinstrument-backed, and pyinstrument installs a **per-Python-call profile
hook** (it fires on every call/return; the sample interval only gates *recording*). On call-heavy
HEP code that hook taxes the data path ~3x **regardless of interval** (measured 2.97x at 1/10/50ms),
so profiling cost ~+53% wall on the benchmark — on the very thread doing the data work. py-spy
(out-of-process) needs root on macOS / ptrace on Linux; scalene refuses a programmatic `start()`
outside its launcher — neither can run in a spawned pool worker. So we took dask's
`distributed.profile` technique: an **off-thread statistical sampler**.

- `graphed_debug._sampler` rewritten: `StackSampler` (pure stdlib) captures its starting thread id on
  `start()`, then a daemon thread reads `sys._current_frames()[tid]` every 10ms and folds the stack
  into a nested **inclusive count tree** (`{name,count,children}` keyed by `func;file;line`; a
  parent's count covers its children → the flamegraph invariant). The task thread is **never hooked**
  — array kernels release the GIL anyway, so the data path pays ~nothing. `flush`/`stop` return the
  tree as JSON bytes (the stable `WorkerProfiler` interface is unchanged, so exec-local's emit
  machinery is untouched). Added `tree_from_bytes`/`merge_into`/`flamegraph` helpers.
- Dashboard consumer: the profile is no longer a Perspective table. `_server` merges the incoming
  trees into one accumulated count tree under its lock and serves the d3-flame-graph JSON at
  **`/api/flamegraph.json`** (snapshot now reports `profile_samples`, not `profile_rows`). `index.html`
  drops the profile Datagrid and renders a **d3 flamegraph** panel (re-vendored `d3.min.js` +
  `d3-flamegraph.min.js`/`.css`) that polls that route. `pyinstrument` dropped from the `dashboard`
  extra + the mypy override; `_wire.profile_message` ships `tree_b64` (was `session_b64`).
- **Re-measured** (full 8-query combined ADL plan, 50k skim x24 = 168 tasks, persistent 4-worker
  `ProcessExecutor`, median of 5; two runs): dashboard comms-only ≈ 0% (-0.1%); profiling ON now
  **+1.5%** vs no dashboard (within noise; ~4300 stack samples merged into a real flamegraph). The
  pyinstrument-era +53% penalty is gone. Resolves "telemetry must not degrade the data path."
- Frozen suites re-authored for the new contract (a sanctioned redo, same basis as freeze-M37-1):
  debug `test_dashboard.py` (sampler tree/flamegraph invariant, merge, malformed-payload guard,
  `/api/flamegraph.json` route, `profile_samples` ingest) + `test_dashboard_browser.py` (waits for the
  `#profile svg.d3-flame-graph` instead of a Datagrid); exec-local capstone asserts
  `profile_samples`/`server.flamegraph().value` cross the process+network boundary. Gates green:
  debug 14/14 frozen m37 + full frozen suite (94.5% cov, `_sampler.py` 97%), ruff + mypy --strict
  clean; exec-local m37 16/16 (incl. the live cross-process capstone); browser test passes headless
  (flamegraph renders, zero JS console/page errors). Re-freeze `freeze-M37-5` (the shared M37
  freeze-event counter: debug last at -3, exec-local at -4; this event bumps both to -5).

## REVISION (2026-06-16) — dashboard UX: flamegraph hover tooltip + dask-style progress bars

Per user direction (the scrolling start/stop task list was hard to parse mid-run; flamegraph cells
truncate names). **graphed-debug only** — graphed-core seam + graphed-exec-local emit unchanged.

- Flamegraph: a shared **pop-out hover tooltip** (delegated `mousemove` on `#profile`, so it survives
  every `chart.update()`) reads the hovered cell's bound datum and shows the full
  `function;file:line` + sample count + % of total. No dependency on d3-flame-graph's (un-bundled)
  tooltip module.
- Tasks: replaced the streaming `tasks` Datagrid with the **dask-distributed "Progress" idiom**
  (studied `distributed/dashboard/components/scheduler.py::TaskProgress` + `diagnostics/progress.py`):
  stacked horizontal bars, one **overall** (finished/in-flight/errored/pending tile the submitted
  total) + one **per worker** (bar length normalized to the busiest worker's load, so stragglers /
  imbalance are visible; green fill = that worker's completion), each with a hover tooltip of its
  counts + most-recent partition. Server side: `_ingest_task` now also folds per-worker counts (under
  the same lock, on the IOLoop thread — NOT the data path), exposed via `progress()` + a new
  `/api/progress.json` route the browser polls (~400ms). The `tasks`/`stats` Perspective tables + the
  whole wire/seam are **unchanged**, so the existing streaming/stats frozen tests stay green.
- **No perf regression** (the whole point of the prior work): the aggregation is server-IOLoop-thread
  only; re-measured the three-way ADL benchmark (same harness) twice — comms penalty within noise
  (-1.0%..+0.9%), profiling within noise (+0.0%..+1.1%). Identical to the pre-change baseline.
- Frozen suite amended (sanctioned redo, same basis as the earlier refreezes): `test_dashboard.py`
  adds progress aggregation (overall + per-worker) + `/api/progress.json` route tests;
  `test_dashboard_browser.py` waits for the `.pbar-row` progress panel (was the tasks Datagrid) and
  asserts the **hover tooltip** appears on both a flamegraph cell and a progress bar. Gates green:
  ruff + mypy --strict clean, full frozen suite 94.9% cov (`_server.py` 93%), sphinx -W, headless
  browser passes (panels render + tooltips work, zero JS errors). Re-freeze **`freeze-M37-6`**
  (debug only; exec-local stays at -5).

## REVISION (2026-06-16) — per-worker bars become a PER-TASK cell strip

Per user direction: the per-worker aggregate-bar hover wasn't granular enough — they want to mouse
over any individual completed/in-flight task. **graphed-debug only.**

- Server: `_workers[w]` now keeps a per-task record (`{key, partition, n_entries, state, t_start,
  t_end, error}`) keyed by task key alongside the aggregate counts — created on `STARTED`, completed
  in place on `FINISHED`/`ERRORED` (tolerant of an out-of-order finish). `progress()` returns each
  worker's `tasks` (deep-copied under the lock, sorted by start time then key — JSON encoding outside
  the lock can't race a concurrent update). Still IOLoop-thread-only, off the data path.
- UI: the overall bar stays an aggregate stacked track; each **worker row is now a chronological
  strip of one `.tcell` per task** coloured by state (cells grow to fill when few, shrink to a 4px
  hoverable min and scroll when many). The delegated `#progress` tooltip prefers a `.tcell` (per-task
  detail: key, partition, entries, state, duration/in-flight, error) over the row.
- No perf regression: same server-side handler category (a dict insert per task event); the bigger
  poll payload is browser-side. Worker emit path unchanged.
- Frozen suite amended (sanctioned redo): `test_dashboard.py` asserts the per-worker `tasks` records
  (keys, states, partition/n_entries carried, finished vs in-flight `t_end`); `test_dashboard_browser`
  hovers an individual `.tcell` and asserts the task tooltip. Gates green: ruff + mypy --strict, full
  frozen suite 95.1% cov (`_server.py` 93%), sphinx -W, headless browser. Re-freeze **`freeze-M37-7`**
  (debug only; exec-local stays at -5).
