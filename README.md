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

## Live execution dashboard (M37)

A creature-comfort, **opt-in** live view of a running `Plan`: while work runs on *any* executor, a
web page shows task progress, per-worker activity, a sampled profile, and any `StageError` mapped to
the user's analysis line. It is built on **[FINOS Perspective](https://perspective.finos.org/)**
tables served over Tornado, fed by a **websocket network transport** — so the dashboard can watch an
executor in the same process *or on another machine*. Unlike dask's always-on Bokeh server, nothing
runs until you ask:

```python
from graphed_debug import Dashboard
from graphed_exec_local.executors import ProcessExecutor

with Dashboard(port=8888, profile=True) as dash:   # serves http://127.0.0.1:8888/
    result = ProcessExecutor(monitor=dash.monitor).run(plan)   # or dash.attach(executor)
# the Perspective server + websocket client are torn down on exit
```

### How it works (three pieces)

The data only ever flows one way — executor → server → browser — and the seam that carries it
(`TaskEvent` + the `Monitor` protocol) lives in `graphed-core`, so it is **render- and
transport-agnostic**. graphed-debug supplies the three concrete pieces:

- **`DashboardServer`** — a `perspective.Server` hosting three live tables (`tasks`, `profile`,
  `stats`) over a Tornado app. A browser `<perspective-viewer>` connects to `/websocket`; executors
  push events to the `/ingest` websocket. It runs its own IOLoop in a daemon thread, so it is fully
  decoupled from the executor.
- **`NetworkMonitor`** — a passive `Monitor` that streams a run's events to a server over a
  websocket. This is the **network transport**: loopback for a local dashboard, or
  `ws://host:port/ingest` to observe an executor running elsewhere. Run it directly for a remote
  setup:

  ```python
  # host A: the dashboard
  from graphed_debug import DashboardServer
  server = DashboardServer(host="0.0.0.0", port=8888).start()   # open http://A:8888/

  # host B: the executor, streaming to A
  from graphed_debug import NetworkMonitor
  ProcessExecutor(monitor=NetworkMonitor("ws://A:8888/ingest").start()).run(plan)
  ```

- **`Dashboard`** — the convenience above: a local `DashboardServer` plus a loopback
  `NetworkMonitor`, so even a same-machine run streams over a real websocket.

### Two guarantees

- **Passive.** Attaching a dashboard — even with `profile=True` — never changes the result: events
  are enqueued to a background sender and **dropped** if the queue fills or the connection is down,
  so the run is never blocked or perturbed. The determinism gate is green attached-or-not.
- **Opt-in.** No server, thread, or socket exists until you construct and `start()` (or `with`) a
  `Dashboard`.

The statistical sampler is [pyinstrument](https://github.com/joerick/pyinstrument): each worker
samples its own stacks and the server flattens the sessions into the `profile` table (function,
location, self/total µs), which the viewer groups and sums. The dashboard stack
(`perspective-python`, `tornado`, `websocket-client`, `pyinstrument`) is the optional **`dashboard`
extra** — `pip install -e ".[dashboard]"` — and the core package stays pure-Python without it.

Defers to the root `graphed-project/CLAUDE.md`; the project plan always wins.
