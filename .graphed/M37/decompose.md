# M37 — Live execution dashboard (passive monitor seam + opt-in viz)

**Primary repo:** `graphed-debug` (the plan's "viz" home).
**Also touches:** `graphed-core` (the data-only contract seam) and `graphed-exec-local` (emit).
**Defers to:** root `graphed-project/CLAUDE.md`; the plan always wins. Out-of-scope items below are
Phase 2.

## 1. Goal

A creature-comfort live dashboard: while a `Plan` runs on **any** executor (`ThreadExecutor`,
`ProcessExecutor`, `SequentialRunner`, or any future one), a **separate thread** serves a webpage
showing task progress, throughput, per-worker activity, a statistical-sampling **flamegraph**, and
any `StageError` mapped to the user's analysis line. Unlike dask (which starts a Bokeh server on
every `Client()`), ours is **opt-in**: nothing runs unless the user constructs a `Dashboard`.

## 2. Non-goals (Phase 2 — MUST NOT build here)

- Browser→run control (pause/cancel) — would need a websocket and a control seam. SSE is one-way.
- Persisting the run event-log into the M9 preservation bundle as a reproducible "run report".
- A network transport for non-local/distributed executors (the seam already supports it; only the
  process side-queue would become a network comm).
- Any Python-side rendering framework (Bokeh/Dash/Streamlit). Python emits JSON; the browser renders.

## 3. Architecture — three layers, strict boundaries

```
graphed-core/execution.py        the SEAM: TaskEvent + Monitor + WorkerProfiler protocols  (data-only, stdlib only)
graphed-exec-local/executors.py  EMIT through the seam   (thread: direct; process: side-queue + collector thread)
graphed-debug/dashboard.py        CONSUME + RENDER: server thread, SSE, ring buffer, static SPA, pyinstrument sampler
```

Rationale (R1.6 — a shared primitive lives at the layer it serves): the event vocabulary is shared
by every executor, so it belongs in `graphed_core.execution` (which is already pure data — no
awkward/numpy, §A.4 safe). Executors only *emit*; they never know what renders. The dashboard is the
*consumer* and is the natural extension of graphed-debug's existing `viz.py` + it reuses
`StageError`/`format_traceback` for the error panel. **`graphed-exec-local` MUST NOT import
pyinstrument** — the sampler is injected through the `WorkerProfiler` protocol and implemented only
in graphed-debug.

## 4. Implementation Targets

### A. `graphed-core` — the contract seam (data-only, no new deps)

- **A1** `TaskPhase(StrEnum)` = `SUBMITTED | STARTED | FINISHED | ERRORED`.
- **A2** `TaskEvent` (frozen dataclass): `phase, key:int, worker:str, t:float, partition:str="",
  n_entries:int=0, bytes_read:int|None=None, error:str|None=None`. Display-only `partition` string
  (e.g. `uri:tree:start-stop`); never carries un-picklable objects (crosses a process boundary).
- **A3** `WorkerProfiler(Protocol)`: `start()->None`, `flush()->bytes|None` (serialized sample tree,
  or `None` if nothing new), `stop()->bytes|None`. No implementation here — graphed-debug supplies it.
- **A4** `Monitor(Protocol, runtime_checkable)`: `on_task(TaskEvent)->None`,
  `on_profile(worker:str, payload:bytes)->None`, `on_combine(leaves_done:int)->None`,
  `worker_profiler_factory()->Callable[[], WorkerProfiler]|None` (a **picklable** factory shipped to
  workers; `None` ⇒ no sampling, MVP tier only).
- **A5** `SequentialRunner.__init__(self, monitor: Monitor | None = None)` and emit
  submitted/started/finished/errored around each `process(...)`; baseline must be observable so the
  determinism comparison covers it.
- **Constraint:** emission helper wraps monitor calls so a monitor that raises **never** breaks the
  run (swallow+continue). Emission is best-effort.

### B. `graphed-exec-local` — emit (no pyinstrument import)

- **B1** `_BaseExecutor.__init__(..., monitor: Monitor | None = None)`; the existing `on_combine`
  test hook is preserved and *also* forwards to `monitor.on_combine` when present.
- **B2** `ThreadExecutor`: `_thread_task` emits STARTED before / FINISHED (or ERRORED) after
  `process(...)`, `worker = threading.current_thread().name`. Monitor called **directly** (shared
  memory); the Dashboard monitor sink is thread-safe. A thread-local pyinstrument profiler (built
  from the factory) starts on first task and flushes periodically.
- **B3** `ProcessExecutor`: when `monitor` is present, create a bounded `multiprocessing.Queue` and
  pass it (+ the picklable `worker_profiler_factory()`) through `_proc_init`. Workers `put_nowait`
  `("task", TaskEvent)` / `("profile", bytes)` tuples; a **driver-side collector daemon thread**
  drains the queue and dispatches to `monitor.on_task` / `monitor.on_profile`. `worker = str(pid)`.
- **B4** **Side channel never blocks work:** `put_nowait` with drop-on-`Full` (bounded queue). A full
  queue drops events; it MUST NOT apply back-pressure to `process(...)` (would perturb timing and the
  adaptive `next_tasks` path → determinism risk).
- **B5** Profiler lifecycle: built from `monitor.worker_profiler_factory()` (if any), `start()` in
  worker init, `flush()` on a coarse cadence (e.g. every N tasks or ~1s), `stop()` at pool teardown;
  serialized bytes ride the side queue (processes) or go direct (threads).

### C. `graphed-debug` — consume + render (the dashboard)

- **C1** `Dashboard(port=0, host="127.0.0.1", profile=False, ring=4096)`: context manager
  (`__enter__`/`__exit__`) + `start()`/`stop()` + `attach(executor)` (sets `executor.monitor=self`) +
  `.monitor` (returns `self`) + `.url`.
- **C2** State (under a lock): bounded `deque` ring of `TaskEvent`s, aggregate counters
  (submitted/started/finished/errored, in-flight, throughput samples), per-worker combined
  pyinstrument session, current flamegraph tree, latest rendered `StageError` traceback.
- **C3** Web server: `ThreadingHTTPServer` in a **daemon thread**. Routes: `GET /` → SPA
  `index.html`; `GET /static/*` → vendored assets; `GET /events` → **SSE** (`text/event-stream`):
  snapshot frame then live deltas, `:` heartbeat comment every ~15 s; `GET /api/state.json` → poll
  fallback (the SSE payload as one document).
- **C4** `Monitor` impl: `on_task` → ring append + counter update + SSE delta enqueue; `on_profile` →
  `Session.from_json(payload)`, `combine` into the running session, recompute flamegraph tree, SSE
  enqueue; `on_combine` → combine-progress update; a StageError event renders via M6
  `format_traceback`.
- **C5** `worker_profiler_factory()`: returns a **picklable** factory (module-level callable)
  building a pyinstrument-backed `WorkerProfiler` — only when `profile=True` *and* pyinstrument
  imports; else `None` (MVP tier still fully works).
- **C6** `_sampler.py`: `PyinstrumentWorkerProfiler` (start/flush/stop → `Session.to_json()` bytes);
  `combine_sessions(a_json, b_json)`; `flamegraph_tree(session)->dict` adapter mapping pyinstrument's
  frame tree to d3-flame-graph's `{name, value, children}`.
- **C7** Static SPA under `src/graphed_debug/static/`: `index.html`, `app.js`, vendored
  `uplot.min.{js,css}`, `d3.min.js`, `d3-flamegraph.min.{js,css}`. Panels: progress bar, throughput
  (uPlot), tasks-in-flight (uPlot), per-worker table, flamegraph (d3-flame-graph), error panel.
  Vendored (offline-capable); CDN `<script>` fallback only if vendoring is blocked at build time.
- **C8** `pyproject.toml`: `[project.optional-dependencies] dashboard = ["pyinstrument>=5"]`; add it
  to `dev` so the suite exercises sampling. uPlot/d3 are vendored static files (no pip dep).

## 5. The passivity invariant (NON-NEGOTIABLE)

The determinism gate (byte-identical reduced result / serialized plan across two runs) **MUST hold
with or without a Dashboard attached, and with `profile=True`.** Enforced by: best-effort drop-on-full
emission (B4); a monitor that raises is swallowed (A5 constraint); the monitor can observe but cannot
influence task order, the reduction tree, or partition resolution. This is a frozen test in *both*
exec-local and graphed-debug.

## 6. Test plan (frozen acceptance suites)

### `graphed-core` `tests/frozen/m37/`
- `test_seam_shape.py`: `TaskEvent` fields/immutability; `Monitor`/`WorkerProfiler` are
  `runtime_checkable` and a minimal recorder satisfies them; `worker_profiler_factory` may be `None`.
- `test_sequential_emits.py`: `SequentialRunner(monitor=rec)` emits the full phase sequence, one
  finished per task; **result + n_combines byte-identical** to `monitor=None`.

### `graphed-exec-local` `tests/frozen/m37/`
- `test_emit_threads.py` / `test_emit_processes.py`: full submitted→started→finished sequence per
  task; finished count == n_partitions; an erroring task emits ERRORED carrying the `StageError`
  summary; worker labels distinct.
- `test_passive_determinism.py`: ThreadExecutor & ProcessExecutor — `ExecResult.value` and
  `n_combines` identical for `monitor=None` vs a recording monitor (and vs a deliberately-slow
  monitor → no back-pressure effect on result).
- `test_emit_best_effort.py`: a monitor whose `on_task` raises does not break the run; a saturated
  side-queue drops events without deadlock/raising.

### `graphed-debug` `tests/frozen/m37/`
- `test_dashboard_monitor.py`: records events; ring bounded; counters correct; `on_combine` tracked.
- `test_sse_stream.py`: live server on an ephemeral port; `GET /events` returns
  `text/event-stream`, yields a snapshot frame then deltas as monitor calls arrive (urllib client +
  a timeout); `GET /` is 200 SPA html; `GET /static/uplot.min.js` serves.
- `test_flamegraph_adapter.py`: a real pyinstrument session → a valid `{name,value,children}` tree;
  `combine_sessions` sums two workers.
- `test_process_integration.py` (capstone): `ProcessExecutor` + `Dashboard(profile=True)` on a real
  corpus analysis → full event stream + non-empty merged flamegraph; **result unchanged** vs no
  dashboard.
- `test_stage_error_panel.py`: a failing analysis surfaces a `StageError` rendered via
  `format_traceback`, pointing at the user line (reuses M6).
- `test_optin_lifecycle.py`: no server thread / bound port before `start()`/`__enter__`; after
  `stop()`/`__exit__` the thread is joined and the port is free; constructing a `Dashboard` and never
  starting it spawns nothing.

### TEST_SANITY (pre-freeze)
Suite collects; **non-vacuous** (fails an un-emitting stub for the right reason); deterministic across
two runs; coverage instrumentation wired. ≥90 % line+branch diff coverage from the **frozen** suite.

## 7. Mechanical gates
`ruff` + `ruff format` · `mypy --strict` (core stubs, exec-local, debug src) · `pytest tests/frozen`
≥90 % · determinism (passivity tests) · integrity scan clean · `sphinx -W` (a new
"How the live dashboard works" section in `design.rst` + `improvements.rst` entries). Run
`python -m graphed_orchestrator.precommit` in each touched repo before any commit.

## 8. Execution sequence
1. **SPIKE (unfrozen)** — implement A+B+C under `tests/extra/`/a scratch driver; validate end-to-end:
   run a plan through Thread + Process executors with a `Dashboard`, open `/events`, confirm events +
   a non-empty flamegraph + unchanged result. Iterate on the seam shape here.
2. **FREEZE** — test-author writes the frozen suites above from the validated behavior; tag
   `freeze-M37-0`. (Cross-repo: core, exec-local, debug each freeze their slice.)
3. **IMPLEMENT** — make frozen green without weakening; gates green in all three repos.
4. **REVIEW + DONE** — reviewer APPROVE; root-prompt **R20** entry; `bookkeep.py`; push when asked.

## 9. Root-prompt entry (draft R20)
> **R20 (live execution dashboard — passive, opt-in, executor-agnostic).** The monitor seam
> (`TaskEvent`/`Monitor`/`WorkerProfiler`) is **data-only in `graphed_core.execution`**; executors
> **emit, never render**; the dashboard lives in **graphed-debug** (the viz home) and reuses
> `format_traceback` for its error panel. It is **opt-in** — no implicit server (unlike dask's
> always-on Bokeh). It is **provably passive**: the determinism gate is green attached-or-not and with
> `profile=True`; emission is best-effort/drop-on-full and MUST NOT back-pressure a worker; a monitor
> that raises is swallowed. The sampler is **pyinstrument behind a `[dashboard]` extra**;
> `graphed-exec-local` stays pyinstrument-free via the `WorkerProfiler` protocol. Rendering is a
> **static SPA (uPlot + d3-flame-graph) over SSE** — no Python rendering framework. Phase 2:
> websocket run-control; persist a run-report into the M9 bundle; a network transport for distributed
> executors.

## 10. Risks
- pyinstrument profiling concurrent worker **threads** (one Profiler per worker thread) — validate in
  the spike; documented fallback is a compact `sys._current_frames()` sampler (dask's algorithm,
  ~80 lines) if per-thread pyinstrument conflicts.
- Vendoring JS offline — if blocked, ship CDN `<script>` fallback and a vendoring note.
- SSE under stdlib `ThreadingHTTPServer` — long-lived streaming handlers; cap concurrent clients and
  use per-client queues with drop-on-slow.
