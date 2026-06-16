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

use std::ops::Deref;
use std::rc::Rc;

use yew::html::{ImplicitClone, IntoPropValue};

/// A thin wrapper around `Rc<T>` whose `PartialEq` uses pointer identity
/// (`Rc::ptr_eq`) instead of deep structural comparison.  This makes it
/// suitable for Yew `Properties` fields that hold large, cheaply-shared
/// snapshots (e.g. `ViewConfig`, `SessionMetadata`, `Vec<String>`).
pub struct PtrEqRc<T>(Rc<T>);

impl<T> PtrEqRc<T> {
    pub fn new(val: T) -> Self {
        Self(Rc::new(val))
    }
}

impl<T> Clone for PtrEqRc<T> {
    fn clone(&self) -> Self {
        Self(Rc::clone(&self.0))
    }
}

impl<T> PartialEq for PtrEqRc<T> {
    fn eq(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
}

impl<T> Deref for PtrEqRc<T> {
    type Target = T;

    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T> From<T> for PtrEqRc<T> {
    fn from(rc: T) -> Self {
        Self(Rc::new(rc))
    }
}

impl<T: Default> Default for PtrEqRc<T> {
    fn default() -> Self {
        Self(Rc::default())
    }
}

impl<T: std::fmt::Debug> std::fmt::Debug for PtrEqRc<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

impl<T> ImplicitClone for PtrEqRc<T> {}

impl<T> IntoPropValue<PtrEqRc<T>> for Rc<T> {
    fn into_prop_value(self) -> PtrEqRc<T> {
        PtrEqRc(self)
    }
}
