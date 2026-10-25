//! Iapetus, the asset pipeline, run as a process of its own so a large build can neither take the
//! editor down with it nor hold it up: a build is stopped by killing it.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

/// Builds running, by the id the editor gave them.
#[derive(Default)]
pub struct Jobs(Mutex<HashMap<String, Arc<Mutex<Child>>>>);

impl Jobs {
  pub fn stop_all(&self) {
    for child in self.0.lock().unwrap().values() {
      let _ = child.lock().unwrap().kill();
    }
  }
}

const NAME: &str = if cfg!(windows) { "iapetus.exe" } else { "iapetus" };

/// `IAPETUS_BIN`, else beside the app's own executable (where a bundled sidecar lands), else on the
/// PATH or in cargo's bin folder, which an app opened from the Finder does not have on its PATH.
fn binary() -> Result<PathBuf, String> {
  if let Some(path) = std::env::var_os("IAPETUS_BIN") {
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
    .ok_or_else(|| "Iapetus was not found. Install it with `cargo install --path <the iapetus repository>`, or set IAPETUS_BIN to its path.".into())
}

/// What a failed run said, without anyhow's `Error: ` prefix.
fn failure(stderr: &[u8]) -> String {
  let text = String::from_utf8_lossy(stderr);
  let text = text.trim();
  text.strip_prefix("Error: ").unwrap_or(text).to_string()
}

/// `iapetus describe <path> --json`: the file's meshes and their maps.
#[tauri::command]
pub async fn iapetus_describe(path: String) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let output = Command::new(binary()?).args(["describe", &path, "--json"]).output().map_err(|error| format!("Iapetus could not be run: {error}"))?;
    if output.status.success() {
      Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
      Err(failure(&output.stderr))
    }
  })
  .await
  .map_err(|error| error.to_string())?
}

/// `iapetus streamable <input> <out> --progress json`: each stage is sent to the editor as an
/// `iapetus:progress` event, and the summary of what was written is the answer.
#[tauri::command]
pub async fn iapetus_streamable(app: tauri::AppHandle, jobs: State<'_, Jobs>, id: String, input: String, out: String, args: Vec<String>) -> Result<String, String> {
  let mut child = Command::new(binary()?)
    .arg("streamable")
    .arg(&input)
    .arg(&out)
    .args(["--progress", "json", "--force"])
    .args(&args)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| format!("Iapetus could not be run: {error}"))?;
  let stdout = child.stdout.take().expect("a piped stdout");
  let mut stderr = child.stderr.take().expect("a piped stderr");
  let child = Arc::new(Mutex::new(child));
  jobs.0.lock().unwrap().insert(id.clone(), child.clone());
  let job = id.clone();
  let (status, done, error, stderr) = tauri::async_runtime::spawn_blocking(move || {
    let errors = std::thread::spawn(move || {
      let mut bytes = Vec::new();
      let _ = stderr.read_to_end(&mut bytes);
      bytes
    });
    let (mut done, mut error) = (None, None);
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
      let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
      if let Some(summary) = message.get("done") {
        done = Some(summary.to_string());
      } else if let Some(text) = message.get("error").and_then(|e| e.as_str()) {
        error = Some(text.to_string());
      } else {
        let _ = app.emit_to("main", "iapetus:progress", serde_json::json!({ "id": job, "progress": message }));
      }
    }
    let status = child.lock().unwrap().wait();
    (status, done, error, errors.join().unwrap_or_default())
  })
  .await
  .map_err(|error| error.to_string())?;
  jobs.0.lock().unwrap().remove(&id);
  match status {
    Ok(status) if status.success() => done.ok_or_else(|| "Iapetus finished without saying what it wrote".into()),
    // Killed: Iapetus had no chance to clear its unfinished folder.
    Ok(status) if status.code().is_none() => {
      let out = Path::new(&out);
      if let (Some(parent), Some(name)) = (out.parent(), out.file_name()) {
        let _ = std::fs::remove_dir_all(parent.join(format!(".{}.partial", name.to_string_lossy())));
      }
      Err("stopped".into())
    }
    _ => Err(error.unwrap_or_else(|| failure(&stderr))),
  }
}

#[tauri::command]
pub fn iapetus_cancel(jobs: State<'_, Jobs>, id: String) {
  if let Some(child) = jobs.0.lock().unwrap().get(&id) {
    let _ = child.lock().unwrap().kill();
  }
}
