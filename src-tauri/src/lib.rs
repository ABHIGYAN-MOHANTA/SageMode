// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use sysinfo::{System};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::collections::HashMap;
use serde::Serialize;
use std::thread;
use core_graphics::display::{CGDisplay, CGMainDisplayID};
use objc::{class, msg_send, sel, sel_impl};
use objc::runtime::{Object, Sel};
use block::Block;

#[derive(Serialize, Clone)]
struct ProcessInfo {
    name: String,
    cpu_usage: f32,
    memory_usage: f64,
    duration: u64, // in seconds
}

#[derive(Serialize, Clone)]
struct TimeEntry {
    app_name: String,
    start_time: u64, // Unix timestamp in seconds
    end_time: u64,   // Unix timestamp in seconds
}

#[derive(Default)]
struct SystemState {
    sys: Mutex<System>,
    process_times: Mutex<HashMap<String, (Instant, u64)>>, // (last_seen, total_duration)
    time_entries: Mutex<Vec<TimeEntry>>,
    current_app: Mutex<Option<(String, u64)>>, // (app_name, start_time)
}

fn get_current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs()
}

fn get_active_window_info() -> Option<(String, String)> {
    unsafe {
        let workspace = class!(NSWorkspace);
        let shared_workspace: *mut Object = msg_send![workspace, sharedWorkspace];
        let active_app: *mut Object = msg_send![shared_workspace, frontmostApplication];
        
        if active_app.is_null() {
            return None;
        }
        
        // Get the bundle identifier
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
        
        // Get the localized name
        let name: *mut Object = msg_send![active_app, localizedName];
        if name.is_null() {
            return None;
        }
        let name_str: *const i8 = msg_send![name, UTF8String];
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
fn get_cpu_usage(state: tauri::State<SystemState>) -> f32 {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_cpu();
    thread::sleep(Duration::from_millis(100)); // Wait a bit to get accurate usage
    sys.refresh_cpu();
    
    let mut total_usage = 0.0;
    let cpu_count = sys.cpus().len() as f32;
    
    for cpu in sys.cpus() {
        total_usage += cpu.cpu_usage();
    }
    
    total_usage / cpu_count
}

#[tauri::command]
fn get_memory_usage(state: tauri::State<SystemState>) -> f32 {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_memory();
    
    let total_memory = sys.total_memory();
    let used_memory = sys.used_memory();
    
    (used_memory as f32 / total_memory as f32) * 100.0
}

#[tauri::command]
fn get_active_processes(state: tauri::State<SystemState>) -> Vec<ProcessInfo> {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_processes();
    sys.refresh_memory();
    
    let mut process_times = state.process_times.lock().unwrap();
    let mut time_entries = state.time_entries.lock().unwrap();
    let mut current_app = state.current_app.lock().unwrap();
    let now = Instant::now();
    let mut active_processes = Vec::new();
    
    // Get the active window info
    let active_window = get_active_window_info();
    
    if let Some((bundle_id, window_name)) = active_window {
        // Find the process that matches the active window
        for (_pid, process) in sys.processes() {
            let name = process.name().to_string();
            let process_lower = name.to_lowercase();
            let window_lower = window_name.to_lowercase();
            
            // Check if this process matches the active window
            if process_lower == window_lower || 
               window_lower.contains(&process_lower) || 
               process_lower.contains(&window_lower) ||
               bundle_id.to_lowercase().contains(&process_lower) {
                
                let cpu_usage = process.cpu_usage();
                let memory_usage = process.memory() as f64 / sys.total_memory() as f64 * 100.0;
                
                let entry = process_times.entry(name.clone()).or_insert((now, 0));
                let (last_seen, total_duration) = *entry;
                
                // Update duration if process was seen in the last 5 seconds
                let new_duration = if now.duration_since(last_seen) < Duration::from_secs(5) {
                    total_duration + now.duration_since(last_seen).as_secs()
                } else {
                    total_duration
                };
                
                *entry = (now, new_duration);

                // Update time tracking
                let current_time = get_current_timestamp();
                if let Some((current_name, start_time)) = current_app.take() {
                    if current_name != name {
                        // Add entry for the previous app
                        if current_time > start_time {  // Only add if there's actual time elapsed
                            time_entries.push(TimeEntry {
                                app_name: current_name,
                                start_time,
                                end_time: current_time,
                            });
                        }
                        // Start tracking the new app
                        *current_app = Some((name.clone(), current_time));
                    } else {
                        // Same app, continue tracking
                        *current_app = Some((name.clone(), start_time));
                    }
                } else {
                    // No app was being tracked, start tracking this one
                    *current_app = Some((name.clone(), current_time));
                }
                
                active_processes.push(ProcessInfo {
                    name,
                    cpu_usage,
                    memory_usage,
                    duration: new_duration,
                });
                
                break;
            }
        }
    }
    
    active_processes
}

#[tauri::command]
fn get_time_entries(state: tauri::State<SystemState>) -> Vec<TimeEntry> {
    let time_entries = state.time_entries.lock().unwrap();
    let current_app = state.current_app.lock().unwrap();
    let current_time = get_current_timestamp();
    
    let mut entries = time_entries.clone();
    
    // Add the current app's time if there is one
    if let Some((app_name, start_time)) = current_app.as_ref() {
        // Only add if it's different from the last entry
        if entries.last().map_or(true, |last| last.app_name != *app_name || last.end_time != *start_time) {
            entries.push(TimeEntry {
                app_name: app_name.clone(),
                start_time: *start_time,
                end_time: current_time,
            });
        }
    }
    
    entries
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SystemState::default())
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
