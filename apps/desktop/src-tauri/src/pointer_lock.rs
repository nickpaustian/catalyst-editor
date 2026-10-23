//! WebKit on macOS asks its UI delegate before granting a page's
//! `requestPointerLock()`, through a private selector wry's delegate does not
//! implement, so every request is refused ("Pointer lock requires the window
//! to have focus"). This adds a handler that says yes to the delegate class.

use block2::Block;
use objc2::ffi::class_addMethod;
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
use objc2::sel;
use objc2_web_kit::WKWebView;
use std::ffi::c_void;

unsafe extern "C-unwind" fn did_request_pointer_lock(_this: *mut AnyObject, _cmd: Sel, _webview: *mut AnyObject, completion: *mut Block<dyn Fn(Bool)>) {
  unsafe { (*completion).call((Bool::YES,)) };
}

/// Grant pointer lock to pages in this webview; a no-op once its delegate class answers.
///
/// # Safety
/// `webview` must point at a live `WKWebView`, as `PlatformWebview::inner` gives.
pub unsafe fn allow(webview: *mut c_void) {
  let webview: &WKWebView = unsafe { &*(webview as *const WKWebView) };
  let Some(delegate) = (unsafe { webview.UIDelegate() }) else { return };
  let class = unsafe { objc2::ffi::object_getClass(objc2::rc::Retained::as_ptr(&delegate) as *const AnyObject).as_ref() }.expect("a delegate has a class");
  let selector = sel!(_webViewDidRequestPointerLock:completionHandler:);
  if class.responds_to(selector) {
    return;
  }
  let imp: Imp = unsafe { std::mem::transmute(did_request_pointer_lock as unsafe extern "C-unwind" fn(_, _, _, _)) };
  unsafe { class_addMethod(class as *const AnyClass as *mut AnyClass, selector, imp, c"v@:@@?".as_ptr()) };
  unsafe { webview.setUIDelegate(Some(&delegate)) };
}
