use sysinfo::System;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::thread;
use std::collections::HashMap;
use std::path::PathBuf;
use std::fs::{self, read_to_string, write};
use serde::{Serialize, Deserialize};
use objc::{class, msg_send, sel, sel_impl};
use objc::runtime::Object;
use tauri::Manager;

/// A snapshot of one running process (as before)
#[derive(Serialize, Deserialize, Clone)]
struct ProcessInfo {
    name: String,
    cpu_usage: f32,
    memory_usage: f64,
    duration: u64, // in seconds
}

/// One time‐interval entry in the timeline
#[derive(Serialize, Deserialize, Clone)]
struct TimeEntry {
    app_name: String,
    start_time: u64, // Unix timestamp in seconds
    end_time: u64,   // Unix timestamp in seconds
}

/// Global application state:
///  • sys: for reading CPU/Memory/process info
///  • process_times: track ephemeral (Instant, total_duration) per process
///  • current_app: (name, start_timestamp) of the frontmost app
///  • entries: persistent Vec<TimeEntry> loaded from JSON on startup
///  • file_path: where to read/write that JSON file
struct SystemState {
    sys: Mutex<System>,
    process_times: Mutex<HashMap<String, (Instant, u64)>>, // (last_seen, total_duration)
    current_app: Mutex<Option<(String, u64)>>,              // (app_name, start_time)
    entries: Mutex<Vec<TimeEntry>>,
    file_path: PathBuf,
}

impl SystemState {
    /// Helper to get the current Unix timestamp in seconds
    fn now_ts() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_else(|_| Duration::from_secs(0))
            .as_secs()
    }
}

/// On macOS, return (bundle_identifier, localizedName) of the frontmost application
fn get_active_window_info() -> Option<(String, String)> {
    unsafe {
        let workspace = class!(NSWorkspace);
        let shared_workspace: *mut Object = msg_send![workspace, sharedWorkspace];
        let active_app: *mut Object = msg_send![shared_workspace, frontmostApplication];

        if active_app.is_null() {
            return None;
        }

        // bundleIdentifier
        let bundle_id: *mut Object = msg_send![active_app, bundleIdentifier];
        if bundle_id.is_null() {
            return None;
        }
        let bundle_id_str: *const i8 = msg_send![bundle_id, UTF8String];
        if bundle_id_str.is_null() {
            return None;
        }
        let bundle_id_cstr = std::ffi::CStr::from_ptr(bundle_id_str);
        let bundle_id = bundle_id_cstr.to_string_lossy().into_owned();

        // localizedName
        let name_obj: *mut Object = msg_send![active_app, localizedName];
        if name_obj.is_null() {
            return None;
        }
        let name_str: *const i8 = msg_send![name_obj, UTF8String];
        if name_str.is_null() {
            return None;
        }
        let name_cstr = std::ffi::CStr::from_ptr(name_str);
        let name = name_cstr.to_string_lossy().into_owned();

        Some((bundle_id, name))
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_cpu_usage(state: tauri::State<'_, SystemState>) -> f32 {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_cpu();
    thread::sleep(Duration::from_millis(100));
    sys.refresh_cpu();

    let mut total = 0.0;
    let count = sys.cpus().len() as f32;
    for cpu in sys.cpus() {
        total += cpu.cpu_usage();
    }
    total / count
}

#[tauri::command]
fn get_memory_usage(state: tauri::State<'_, SystemState>) -> f32 {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_memory();
    let total_mem = sys.total_memory() as f32;
    let used_mem = sys.used_memory() as f32;
    (used_mem / total_mem) * 100.0
}

/// Returns at most one ProcessInfo (the frontmost tracked process).
/// Also handles "app switch" detection, appends a new TimeEntry to `entries`,
/// then writes the entire JSON file back out.
#[tauri::command]
fn get_active_processes(state: tauri::State<'_, SystemState>) -> Vec<ProcessInfo> {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_processes();
    sys.refresh_memory();

    let mut process_times = state.process_times.lock().unwrap();
    let mut current_app = state.current_app.lock().unwrap();
    let mut entries = state.entries.lock().unwrap();
    let file_path = state.file_path.clone();

    let now_instant = Instant::now();
    let now_ts = SystemState::now_ts();
    let mut out = Vec::new();

    // 1) Find the frontmost window's bundle_id and name
    if let Some((bundle_id, window_name)) = get_active_window_info() {
        // 2) Search through sys.processes() for a matching process
        for (_pid, process) in sys.processes() {
            let name = process.name().to_owned();
            let process_lower = name.to_lowercase();
            let window_lower = window_name.to_lowercase();

            if process_lower == window_lower
                || window_lower.contains(&process_lower)
                || process_lower.contains(&window_lower)
                || bundle_id.to_lowercase().contains(&process_lower)
            {
                let cpu_pct = process.cpu_usage();
                let mem_pct = (process.memory() as f64 / sys.total_memory() as f64) * 100.0;

                // Update in-memory duration tracking
                let entry = process_times.entry(name.clone()).or_insert((now_instant, 0));
                let (last_seen, total_dur) = *entry;
                let new_dur = if now_instant.duration_since(last_seen) < Duration::from_secs(5) {
                    total_dur + now_instant.duration_since(last_seen).as_secs()
                } else {
                    total_dur
                };
                *entry = (now_instant, new_dur);

                // 3) If we switched away from a previously-tracked app, create a new TimeEntry
                if let Some((prev_name, prev_start)) = current_app.take() {
                    if prev_name != name {
                        if now_ts > prev_start {
                            // Append to `entries`
                            entries.push(TimeEntry {
                                app_name: prev_name,
                                start_time: prev_start,
                                end_time: now_ts,
                            });
                        }
                        // Start tracking the new app
                        *current_app = Some((name.clone(), now_ts));
                    } else {
                        // Still the same app – keep the same start_time
                        *current_app = Some((name.clone(), prev_start));
                    }
                } else {
                    // No app was being tracked yet
                    *current_app = Some((name.clone(), now_ts));
                }

                // 4) Immediately write out the entire `entries` Vec to the JSON file
                // (if serialization or write fails, we simply log to stderr)
                if let Err(e) = write(
                    &file_path,
                    serde_json::to_string_pretty(&*entries).unwrap_or_else(|_| "[]".to_string()),
                ) {
                    eprintln!("Failed to write time_entries.json: {}", e);
                }

                // 5) Return this single frontmost process info
                out.push(ProcessInfo {
                    name,
                    cpu_usage: cpu_pct,
                    memory_usage: mem_pct,
                    duration: new_dur,
                });
                break;
            }
        }
    }

    out
}

/// Return all stored TimeEntries (from memory), plus a "live" entry if current_app is set.
#[tauri::command]
fn get_time_entries(state: tauri::State<'_, SystemState>) -> Vec<TimeEntry> {
    let mut result = state.entries.lock().unwrap().clone();

    // Append a "live" entry for whatever's currently frontmost
    if let Some((ref name, start_ts)) = *state.current_app.lock().unwrap() {
        let now_ts = SystemState::now_ts();
        if result
            .last()
            .map_or(true, |last| last.app_name != *name || last.end_time != start_ts)
        {
            result.push(TimeEntry {
                app_name: name.clone(),
                start_time: start_ts,
                end_time: now_ts,
            });
        }
    }

    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Build the path: ~/Library/Application Support/SageMode/time_entries.json
            let mut support_dir = app.path().app_data_dir().expect("failed to resolve app_data_dir");
            support_dir.push("SageMode");
            fs::create_dir_all(&support_dir).expect("couldn't create app support dir");
            support_dir.push("time_entries.json");

            // 2) Load existing contents, if any. If the file does not exist or is invalid, start with empty Vec.
            let existing_entries: Vec<TimeEntry> = match read_to_string(&support_dir) {
                Ok(content) => {
                    serde_json::from_str(&content).unwrap_or_else(|e| {
                        eprintln!(
                            "Could not parse existing time_entries.json ({}). Starting empty. Err: {}",
                            support_dir.display(),
                            e
                        );
                        Vec::new()
                    })
                }
                Err(_) => {
                    // File doesn't exist or can't be read → start with empty Vec
                    Vec::new()
                }
            };

            // 3) Build the shared SystemState
            let state = SystemState {
                sys: Mutex::new(System::new_all()),
                process_times: Mutex::new(HashMap::new()),
                current_app: Mutex::new(None),
                entries: Mutex::new(existing_entries),
                file_path: support_dir.clone(),
            };

            app.manage(state);
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_cpu_usage,
            get_memory_usage,
            get_active_processes,
            get_time_entries
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
