use std::sync::Mutex;
use tauri::{Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri_plugin_window_state::StateFlags;

mod iapetus;
#[cfg(target_os = "macos")]
mod pointer_lock;

/// Project files (`.catalyst`) the app was launched with or asked to open, until the editor window takes them.
struct OpenedFiles(Mutex<Vec<String>>);

const PROJECT_EXTENSION: &str = ".catalyst";
const QUIT_ID: &str = "catalyst-quit";

fn project_files<I: IntoIterator<Item = String>>(candidates: I) -> Vec<String> {
  candidates.into_iter().filter(|path| path.ends_with(PROJECT_EXTENSION)).collect()
}

#[tauri::command]
fn take_opened_files(state: tauri::State<OpenedFiles>) -> Vec<String> {
  std::mem::take(&mut *state.0.lock().unwrap())
}

/// `git init` in a project folder, through the git on the PATH.
#[tauri::command]
fn init_git(path: String) -> Result<String, String> {
  let output = std::process::Command::new("git")
    .arg("init")
    .current_dir(&path)
    .output()
    .map_err(|error| format!("git could not be run: {error}"))?;
  if output.status.success() {
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
  } else {
    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
  }
}

/// Show a file or folder in the system's file manager: selected in Finder or Explorer, or its folder opened elsewhere.
#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
  if !std::path::Path::new(&path).exists() {
    return Err(format!("{path} is not there"));
  }
  #[cfg(target_os = "macos")]
  let spawned = std::process::Command::new("open").arg("-R").arg(&path).spawn();
  // Explorer wants backslashes, and the selection as part of the one argument.
  #[cfg(target_os = "windows")]
  let spawned = std::process::Command::new("explorer").arg(format!("/select,{}", path.replace('/', "\\"))).spawn();
  #[cfg(all(unix, not(target_os = "macos")))]
  let spawned = {
    let folder = std::path::Path::new(&path).parent().map(|p| p.to_path_buf()).unwrap_or_else(|| path.clone().into());
    std::process::Command::new("xdg-open").arg(folder).spawn()
  };
  spawned.map(|_| ()).map_err(|error| format!("the file manager could not be opened: {error}"))
}

/// Ask the editor window, which may have unsaved work, to quit; it closes itself when it may go.
fn request_quit<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
  if app.get_webview_window("main").is_some() {
    let _ = app.emit_to("main", "catalyst:quit-requested", ());
  } else {
    app.exit(0);
  }
}

/// The default menu with its Quit swapped for one of ours: the stock item terminates the app outright, before the editor can ask about unsaved work.
#[cfg(target_os = "macos")]
fn menu_with_guarded_quit<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
  let menu = Menu::default(app)?;
  if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
    let items = app_menu.items()?;
    let stock_quit = items.iter().enumerate().find_map(|(index, item)| match item {
      MenuItemKind::Predefined(predefined) => predefined.text().ok().filter(|text| text.starts_with("Quit")).map(|text| (index, text)),
      _ => None,
    });
    if let Some((index, text)) = stock_quit {
      app_menu.remove_at(index)?;
      app_menu.insert(&MenuItem::with_id(app, QUIT_ID, text, true, Some("CmdOrCtrl+Q"))?, index)?;
    }
  }
  Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .manage(OpenedFiles(Mutex::new(project_files(std::env::args().skip(1)))))
    .manage(iapetus::Jobs::default())
    .invoke_handler(tauri::generate_handler![init_git, take_opened_files, reveal_in_file_manager, iapetus::iapetus_describe, iapetus::iapetus_streamable, iapetus::iapetus_cancel])
    .on_menu_event(|app, event| {
      if event.id() == QUIT_ID {
        request_quit(app);
      }
    })
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    // The project window comes back at the size, place and maximised state it was left in; the launcher keeps its own.
    .plugin(
      tauri_plugin_window_state::Builder::new()
        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN)
        .with_denylist(&["start"])
        .build(),
    )
    .on_page_load(|webview, _| {
      #[cfg(target_os = "macos")]
      let _ = webview.with_webview(|platform| unsafe { pointer_lock::allow(platform.inner()) });
      #[cfg(not(target_os = "macos"))]
      let _ = webview;
    })
    .setup(|app| {
      #[cfg(target_os = "macos")]
      app.set_menu(menu_with_guarded_quit(app.handle())?)?;
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");
  app.run(|app, event| {
    // A build still running would outlive the app.
    if let tauri::RunEvent::Exit = event {
      app.state::<iapetus::Jobs>().stop_all();
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    if let tauri::RunEvent::Opened { urls } = event {
      let paths = project_files(urls.iter().filter_map(|url| url.to_file_path().ok()).map(|path| path.to_string_lossy().to_string()));
      if paths.is_empty() {
        return;
      }
      app.state::<OpenedFiles>().0.lock().unwrap().extend(paths.clone());
      let _ = app.emit_to("main", "catalyst:open-files", paths);
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    let _ = (app, event);
  });
}
