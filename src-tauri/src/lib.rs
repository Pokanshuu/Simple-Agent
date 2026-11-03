#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod docx;
mod models;
mod net;
mod secrets;
mod tools;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub db: db::Db,
    pub streams: net::StreamRegistry,
    pub client: reqwest::Client,
    pub data_dir: PathBuf,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::Manager;

            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            std::fs::create_dir_all(&data_dir)?;

            let db_path = db::db_path(&data_dir);
            let db = db::Db::open(&db_path)?;
            // A process killed mid-stream leaves rows in STREAMING forever.
            let repaired = db::resolve_dangling_streams(&db).unwrap_or(0);
            if repaired > 0 {
                println!("[db] repaired {repaired} dangling streaming message(s)");
            }

            app.manage(AppState {
                db,
                streams: Arc::new(Mutex::new(HashMap::new())),
                client: net::build_client(),
                data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // conversations
            commands::list_conversations,
            commands::find_conversation,
            commands::create_conversation,
            commands::update_conversation,
            commands::delete_conversation,
            commands::touch_conversation,
            commands::fork_conversation,
            // messages
            commands::load_messages,
            commands::append_message,
            commands::update_message,
            commands::set_active_variant,
            commands::delete_subtree,
            // drafts
            commands::get_draft,
            commands::save_draft,
            commands::clear_draft_title,
            commands::list_drafts,
            // presets
            commands::list_presets,
            commands::save_preset,
            commands::delete_preset,
            commands::get_conversation_presets,
            commands::set_conversation_presets,
            // compactions
            commands::get_compaction,
            commands::save_compaction,
            commands::delete_compaction,
            // settings / search / backup
            commands::get_settings,
            commands::save_settings,
            commands::search_conversations,
            commands::export_backup_to,
            commands::import_backup_from,
            commands::import_chatbox_from,
            // agent
            commands::run_tool,
            commands::audit_tool_call,
            tools::workspace_info,
            // files
            commands::read_text_file,
            commands::read_image_file,
            commands::write_text_file,
            commands::app_info,
            // network
            net::chat_stream,
            net::cancel_stream,
            net::http_get,
            // secrets
            secrets::save_api_key,
            secrets::load_api_key,
            secrets::clear_api_key,
            secrets::api_key_hint,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
