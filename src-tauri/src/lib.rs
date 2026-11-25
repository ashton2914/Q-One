pub mod project;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(project::AppState::default())
        .invoke_handler(tauri::generate_handler![
            project::import_pdf,
            project::get_drawing_bytes,
            project::remove_drawing_bytes,
            project::clear_drawings,
            project::save_project,
            project::open_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running DM-One application");
}
