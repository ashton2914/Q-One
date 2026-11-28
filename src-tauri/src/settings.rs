use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PdfDisplaySettings {
    pub theme: String,
    pub line_weight_mode: String,
    pub custom_line_width: f64,
    pub high_contrast: bool,
}

impl Default for PdfDisplaySettings {
    fn default() -> Self {
        Self {
            theme: "light".to_string(),
            line_weight_mode: "original".to_string(),
            custom_line_width: 1.5,
            high_contrast: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub pdf_display: PdfDisplaySettings,
}

pub fn resolve_settings_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "Unable to determine user home directory".to_string())?;
    Ok(PathBuf::from(home)
        .join(".config")
        .join("qone")
        .join("settings.json"))
}

pub fn load_settings_from_path(path: &Path) -> Result<AppSettings, String> {
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read settings file: {e}"))?;
    serde_json::from_str::<AppSettings>(&raw)
        .map_err(|e| format!("Failed to parse settings file: {e}"))
}

pub fn save_settings_to_path(path: &Path, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings directory: {e}"))?;
    }
    let payload = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, payload.as_bytes())
        .map_err(|e| format!("Failed to write temporary settings file: {e}"))?;
    fs::rename(&tmp_path, path)
        .map_err(|e| format!("Failed to finalize settings file: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn load_app_settings() -> Result<AppSettings, String> {
    let path = resolve_settings_path()?;
    load_settings_from_path(&path)
}

#[tauri::command]
pub fn save_app_settings(settings: AppSettings) -> Result<(), String> {
    let path = resolve_settings_path()?;
    save_settings_to_path(&path, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_settings_path() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("qone-settings-test-{nanos}"))
            .join(".config")
            .join("qone")
            .join("settings.json")
    }

    #[test]
    fn returns_defaults_when_settings_file_does_not_exist() {
        let path = unique_temp_settings_path();
        let loaded = load_settings_from_path(&path).unwrap();
        assert_eq!(loaded, AppSettings::default());
    }

    #[test]
    fn saves_and_loads_pdf_display_settings_round_trip() {
        let path = unique_temp_settings_path();
        let custom = AppSettings {
            pdf_display: PdfDisplaySettings {
                theme: "dark".to_string(),
                line_weight_mode: "custom".to_string(),
                custom_line_width: 2.25,
                high_contrast: true,
            },
        };
        save_settings_to_path(&path, &custom).unwrap();
        let loaded = load_settings_from_path(&path).unwrap();
        assert_eq!(loaded, custom);
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap().parent().unwrap());
    }
}
