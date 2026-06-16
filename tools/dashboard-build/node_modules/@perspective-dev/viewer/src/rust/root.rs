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

use std::cell::{Ref, RefCell, RefMut};
use std::rc::Rc;

use derivative::Derivative;
use yew::{AppHandle, Component};

#[derive(Default, Derivative)]
#[derivative(Clone(bound = ""))]
pub struct Root<T: Component>(Rc<RefCell<Option<AppHandle<T>>>>);

impl<T: Component> PartialEq for Root<T> {
    fn eq(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
}

// We want to use libraries that are designed to require thread-safety, in the
// JavaScript environment that (currently) does not allow threads. If we were
// to implement a threaded build, we'd need to replace with true
// synchronization.
unsafe impl<T: Component> Send for Root<T> {}
unsafe impl<T: Component> Sync for Root<T> {}

impl<T: Component> Root<T> {
    pub fn new(shadow_root: web_sys::Element, props: T::Properties) -> Self {
        Self(Rc::new(RefCell::new(Some(
            yew::Renderer::with_root_and_props(shadow_root, props).render(),
        ))))
    }

    pub fn borrow(&self) -> Ref<'_, Option<AppHandle<T>>> {
        self.0.borrow()
    }

    pub fn borrow_mut(&self) -> RefMut<'_, Option<AppHandle<T>>> {
        self.0.borrow_mut()
    }
}
