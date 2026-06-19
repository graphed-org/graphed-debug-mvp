# graphed-debug

Debugging for **graphed** (milestone M6): opt-level lowering, source-mapped **picklable** tracebacks,
and visualization.

The headline guarantee (plan A.3 #8): a runtime error — even one raised deep inside a fused stage on a
remote worker **process** — is re-raised in the driver as a `StageError` whose `format_traceback`
points at the **user's analysis line**, never a raw opaque worker traceback.

This package turns the IR plus the M3 provenance into human-readable debugging output. It is *not* an
executor (that is M7) and *not* an interactive/time-travel debugger (Phase 2): lowering, error
surfacing, and visualization only.

## Lowering — choosing how literally to run

`lower(session, array, opt_level=...)` walks the recorded graph and produces a `LoweredGraph`: stages
of `LoweredOp` members, each member carrying its operator token, its input references, its inferred
form, and **its own** `SourceFrame` (the user line that recorded it).

- `opt_level=0` — **one op per stage, 1:1 with the user's code**, no fusion. The canonical mode for
  pinpointing where a value first goes wrong; the debug runner additionally checks inter-op
  consistency as it goes.
- `opt_level>=1` — maximal op runs between boundaries are **fused** into multi-member stages, the same
  M4 boundary rule the real optimizer uses, so the structure you debug matches what executes.

Source frames attach to *members*, not stages, so a fused four-op stage carries four frames — that is
why optimization never costs the traceback: the arrow lands on the exact line even when the failing op
is buried mid-stage.

## StageError — the diagnosis as a real exception

`run(session, array, opt_level=..., partition=...)` executes the lowered graph op-by-op (localizing a
failure even inside a fused stage) and, on the first failing op, raises a `StageError` carrying:

- `op` — the failing operator;
- `frames` — the user's analysis frames, with `user_frame` the closest one;
- `input_forms` — the inferred types feeding the op (often the diagnosis by itself);
- `partition` — *which* chunk of data tripped it (data-dependent bugs fail on some partitions and not
  others);
- `cause_type` / `cause_message` — the underlying exception, as data;
- `opt_level` — which structure was executing.

Two properties are pinned by tests rather than promised:

- **It pickles intact.** Custom `__reduce__`/`__setstate__` carry every structured field (not just
  `args`), so a worker process can raise it, a futures executor can transport it, and the driver
  re-raises the *same* diagnosis. It never degrades to an opaque string and deliberately carries no
  un-picklable live traceback object.
- **It renders for humans.** `format_traceback(err)` collapses `graphed*` internal frames, renders the
  user frames with a `-->` arrow on the faulty line, and appends the op, forms, partition, and cause —
  byte-identical before and after a pickle round-trip.

This package handles *run-time* failures. Record-time type errors never get this far: the frontend's
form inference raises at the offending line before any data is read.

## Visualization

`visualize(lowered, fmt="mermaid"|"graphviz", projection=...)` renders the lowered graph as diagram
source — stages with their member ops, boundaries distinct, and (optionally) each source annotated
with its M5 projected columns. Deterministic text output, suitable for docs, notebooks, and diffing
two lowerings of the same analysis.

## Live execution dashboard (M37)

A creature-comfort, **opt-in** live view of a running `Plan`: while work runs on *any* executor, a web
page shows task progress, per-worker activity, a sampled profile, and any `StageError` mapped to the
user's analysis line. It is built on **[FINOS Perspective](https://perspective.finos.org/)** tables
served over Tornado, fed by a **websocket network transport** — so the dashboard can watch an executor
in the same process *or on another machine*. Unlike dask's always-on Bokeh server, nothing runs until
you ask:

```python
from graphed_debug import Dashboard
from graphed_exec_local.executors import ProcessExecutor

with Dashboard(port=8888, profile=True) as dash:   # serves http://127.0.0.1:8888/
    result = ProcessExecutor(monitor=dash.monitor).run(plan)   # or dash.attach(executor)
# the Perspective server + websocket client are torn down on exit
```

### How it works (three pieces)

The data only ever flows one way — executor → server → browser — and the seam that carries it
(`TaskEvent` + the `Monitor` / `WorkerProfiler` protocols) lives in `graphed-core`, so it is **render-
and transport-agnostic** (it survived the move from an earlier SSE prototype to Perspective
unchanged). `graphed-debug` supplies the three concrete pieces:

- **`DashboardServer`** — a `perspective.Server` hosting the live `stats` and `tasks` tables over a
  Tornado app, plus two derived JSON views the browser polls: a merged-profile **flamegraph** at
  `/api/flamegraph.json` and overall + per-worker **progress** at `/api/progress.json`. A browser
  `<perspective-viewer>` connects to `/websocket`; executors push events to the `/ingest` websocket. It
  runs its own IOLoop in a daemon thread, fully decoupled from the executor.
- **`NetworkMonitor`** — a passive `Monitor` that streams a run's events to a server over a websocket.
  This is the **network transport**: loopback for a local dashboard, or `ws://host:port/ingest` to
  observe an executor running elsewhere. Run it directly for a remote setup:

  ```python
  # host A: the dashboard
  from graphed_debug import DashboardServer
  server = DashboardServer(host="0.0.0.0", port=8888).start()   # open http://A:8888/

  # host B: the executor, streaming to A
  from graphed_debug import NetworkMonitor
  from graphed_exec_local import ProcessExecutor
  ProcessExecutor(monitor=NetworkMonitor("ws://A:8888/ingest").start()).run(plan)
  ```

- **`Dashboard`** — the convenience above: a local `DashboardServer` plus a loopback `NetworkMonitor`,
  so even a same-machine run streams over a real websocket.

### Two guarantees

- **Passive.** Attaching a dashboard — even with `profile=True` — never changes the result: events are
  enqueued to a background sender and **dropped** if the queue fills or the connection is down, so the
  run is never blocked or perturbed. The determinism gate is green attached-or-not.
- **Opt-in.** No server, thread, or socket exists until you construct and `start()` (or `with`) a
  `Dashboard`.

### The profiler

The sampler is **off-thread** and pure stdlib (`graphed_debug._sampler`, the dask
`distributed.profile` technique): rather than a per-call profiler that hooks *every* Python call (the
~3x tax on call-heavy HEP code that motivated dropping pyinstrument), `StackSampler` samples its
worker's task thread from a **separate daemon thread** via `sys._current_frames()` every ~10 ms — so
the data path is never hooked (array kernels release the GIL anyway). Each sample folds the stack into
an inclusive **count tree**; `graphed-exec-local` drives this via the abstract `WorkerProfiler`. The
server merges the per-worker trees into one and serves it as a d3 **flamegraph**, which the browser
renders client-side; hovering a frame pops out its full `function;file:line`, sample count, and
percentage. The task view is the dask-distributed Progress/Task-Stream idiom: one stacked overall bar
plus, per worker, a strip of one hoverable cell per task coloured by state.

The dashboard stack (`perspective-python` pinned to 4.5.1, `tornado`, `websocket-client`) is the
optional **`dashboard` extra** — `pip install -e ".[dashboard]"` — and there is no third-party profiler
dependency. The core package stays pure-Python and import-clean without it.

## Dependencies and gates

Runtime: `graphed` (frontend: `walk`, `provenance`, `source_value`) + `graphed-core` (the execution
seam). Tests also use `graphed-numpy` / `graphed-awkward` / `graphed-corpus` for realistic analyses.
Gates: `ruff` + `ruff format` · `mypy --strict` · `pytest tests/frozen --cov=graphed_debug` (≥90%) ·
`sphinx -W`.

See `docs/design.rst` for the full engineering walkthrough.

Defers to the root `graphed-project/CLAUDE.md`; the project plan always wins.
