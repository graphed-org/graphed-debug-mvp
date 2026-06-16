// ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
// ┃ ██████ ██████ ██████       █      █      █      █      █ █▄  ▀███ █       ┃
// ┃ ▄▄▄▄▄█ █▄▄▄▄▄ ▄▄▄▄▄█  ▀▀▀▀▀█▀▀▀▀▀ █ ▀▀▀▀▀█ ████████▌▐███ ███▄  ▀█ █ ▀▀▀▀▀ ┃
// ┃ █▀▀▀▀▀ █▀▀▀▀▀ █▀██▀▀ ▄▄▄▄▄ █ ▄▄▄▄▄█ ▄▄▄▄▄█ ████████▌▐███ █████▄   █ ▄▄▄▄▄ ┃
// ┃ █      ██████ █  ▀█▄       █ ██████      █      ███▌▐███ ███████▄ █       ┃
// ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
// ┃ Copyright (c) 2017, the Perspective Authors.                              ┃
// ┃ ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ┃
// ┃ This file is part of the Perspective library, distributed under the terms ┃
// ┃ of the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). ┃
// ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

use std::cell::Cell;
use std::future::Future;
use std::rc::Rc;

use async_lock::Mutex;
use perspective_js::utils::ApiResult;

#[derive(Default)]
struct DebounceMutexData {
    id: Cell<u64>,
    mutex: Mutex<u64>,
}

/// An async `Mutex` type specialized for Perspective's rendering, which
/// debounces calls in addition to providing exclusivity. Calling `debounce`
/// with a _cancellable_ [`Future`] will resolve only after at least one
/// _complete_ evaluation of a call awaiting the lock.
#[derive(Clone, Default)]
pub struct DebounceMutex(Rc<DebounceMutexData>);

impl DebounceMutex {
    /// Lock like a normal `Mutex`.
    pub async fn lock<T>(&self, f: impl Future<Output = T>) -> T {
        let mut last = self.0.mutex.lock().await;
        let next = self.0.id.get();
        let result = f.await;
        *last = next;
        result
    }

    /// Lock and also debounce `f`, which should be cancellable.
    pub async fn debounce(&self, f: impl Future<Output = ApiResult<()>>) -> ApiResult<()> {
        let next = self.0.id.get() + 1;
        let mut last = self.0.mutex.lock().await;
        if *last < next {
            let next = self.0.id.get() + 1;
            self.0.id.set(next);
            let result = f.await;
            if result.is_ok() {
                *last = next;
            }

            result
        } else {
            Ok(())
        }
    }
}
