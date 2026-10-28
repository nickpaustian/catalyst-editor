//! The native runner (`catalyst-runner`, from catalyst-rs) as ▶ Run's sidecar: a process of its own
//! drawing the scene the editor has open, through the Rust engine. One run at a time; a new run
//! replaces the last.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Emitter, State};

#[derive(Default)]
pub struct Run(Mutex<Option<Child>>);

impl Run {
  pub fn stop(&self) {
    if let Some(mut child) = self.0.lock().unwrap().take() {
      let _ = child.kill();
      let _ = child.wait();
    }
  }
}

const NAME: &str = if cfg!(windows) { "catalyst-runner.exe" } else { "catalyst-runner" };

/// `CATALYST_RUNNER_BIN`, else beside the app's own executable (where a bundled sidecar lands), else on the
/// PATH or in cargo's bin folder, which an app opened from the Finder does not have on its PATH.
fn binary() -> Result<PathBuf, String> {
  if let Some(path) = std::env::var_os("CATALYST_RUNNER_BIN") {
    return Ok(path.into());
  }
  let mut dirs: Vec<PathBuf> = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)).into_iter().collect();
  dirs.extend(std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).unwrap_or_default());
  if let Some(home) = std::env::var_os("HOME") {
    dirs.push(PathBuf::from(home).join(".cargo/bin"));
  }
  dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
  dirs
    .into_iter()
    .map(|dir| dir.join(NAME))
    .find(|candidate| candidate.is_file())
    .ok_or_else(|| "The native runner was not found. Install it with `cargo install --path apps/runner` in the catalyst-rs repository, or set CATALYST_RUNNER_BIN to its path.".into())
}

/// Play `scene` (the scene JSON as the editor has it, its names already paths under `project`) in the native runner,
/// with `files` (project paths to their JSON as the editor has it) read in place of the project's own. The scene and
/// the files go through files of their own, so unsaved edits play without touching the project.
#[tauri::command]
pub async fn runner_launch(app: tauri::AppHandle, run: State<'_, Run>, project: String, scene: String, files: HashMap<String, String>) -> Result<(), String> {
  let dir = std::env::temp_dir().join(format!("catalyst-run-{}", std::process::id()));
  std::fs::create_dir_all(&dir).map_err(|error| format!("the run's files could not be written for the runner: {error}"))?;
  let file = dir.join("scene.json");
  std::fs::write(&file, scene).map_err(|error| format!("the scene could not be written for the runner: {error}"))?;
  let mut command = Command::new(binary()?);
  command.arg(&project).arg("--scene").arg(&file);
  for (index, (path, json)) in files.iter().enumerate() {
    let stand_in = dir.join(format!("file-{index}.json"));
    std::fs::write(&stand_in, json).map_err(|error| format!("{path} could not be written for the runner: {error}"))?;
    command.arg("--file").arg(format!("{path}={}", stand_in.display()));
  }
  run.stop();
  let child = command.spawn().map_err(|error| format!("the native runner could not be run: {error}"))?;
  let id = child.id();
  *run.0.lock().unwrap() = Some(child);
  let _ = app.emit_to("main", "runner:started", id);
  Ok(())
}

/// Whether the launched run is still going; says so with an event when it has ended.
#[tauri::command]
pub fn runner_running(app: tauri::AppHandle, run: State<'_, Run>) -> bool {
  let mut guard = run.0.lock().unwrap();
  let running = match guard.as_mut() {
    Some(child) => matches!(child.try_wait(), Ok(None)),
    None => false,
  };
  if !running && guard.take().is_some() {
    let _ = app.emit_to("main", "runner:exited", ());
  }
  running
}

#[tauri::command]
pub fn runner_stop(run: State<'_, Run>) {
  run.stop();
}

#[tauri::command]
pub fn runner_available() -> bool {
  binary().is_ok()
}
