// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use sysinfo::{System};
use std::sync::Mutex;
use std::time::Duration;
use std::thread;

#[derive(Default)]
struct SystemState {
    sys: Mutex<System>,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SystemState::default())
        .invoke_handler(tauri::generate_handler![greet, get_cpu_usage, get_memory_usage])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
