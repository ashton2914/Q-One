use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;
use tempfile::NamedTempFile;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub const CURRENT_SCHEMA_VERSION: u32 = 1;

fn default_marker_width() -> f64 {
    0.04
}

fn default_marker_height() -> f64 {
    0.025
}

fn default_quantity() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarkerPosition {
    pub drawing_id: String,
    pub page: u32,
    pub x: f64,
    pub y: f64,
    #[serde(default = "default_marker_width")]
    pub width: f64,
    #[serde(default = "default_marker_height")]
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Dimension {
    pub id: String,
    #[serde(default)]
    pub drawing_id: Option<String>,
    #[serde(default)]
    pub balloon_number: u32,
    #[serde(default)]
    pub dimension_type: String,
    pub name: String,
    #[serde(default = "default_quantity")]
    pub quantity: u32,
    pub nominal: String,
    pub upper_tol: String,
    pub lower_tol: String,
    pub unit: String,
    pub notes: String,
    pub marker: Option<MarkerPosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub part_number: String,
    #[serde(default)]
    pub revision: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub drawing_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DrawingEntry {
    pub id: String,
    pub filename: String,
    pub archive_path: String,
    pub page_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectData {
    pub schema_version: u32,
    pub project_id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub parts: Vec<Part>,
    pub drawings: Vec<DrawingEntry>,
    pub dimensions: Vec<Dimension>,
}

#[derive(Default)]
pub struct AppState {
    pub drawings: Mutex<HashMap<String, Vec<u8>>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPdfPayload {
    pub drawing_id: String,
    pub filename: String,
    pub pdf_bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProjectPayload {
    pub project: ProjectData,
    pub active_drawing_id: Option<String>,
    pub pdf_bytes: Option<Vec<u8>>,
}

pub fn validate_pdf_bytes(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 5 || !bytes.starts_with(b"%PDF-") {
        return Err(
            "Selected file is not a valid PDF document (missing %PDF- header).".to_string(),
        );
    }
    Ok(())
}

fn validate_archive_path(archive_path: &str) -> Result<(), String> {
    if !archive_path.starts_with("drawings/")
        || archive_path.contains("..")
        || archive_path.contains('\\')
        || archive_path.len() <= "drawings/".len()
    {
        return Err(format!("Invalid drawing archive path: '{}'", archive_path));
    }
    Ok(())
}

pub fn write_dmone_atomic(
    path: &Path,
    project: &ProjectData,
    drawings_map: &HashMap<String, Vec<u8>>,
) -> Result<(), String> {
    if project.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported project schema version: {}",
            project.schema_version
        ));
    }

    for drawing in &project.drawings {
        validate_archive_path(&drawing.archive_path)?;
        let bytes = drawings_map.get(&drawing.id).ok_or_else(|| {
            format!(
                "Missing cached PDF bytes for drawing '{}' ({}).",
                drawing.filename, drawing.id
            )
        })?;
        validate_pdf_bytes(bytes)?;
    }

    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));

    let mut temp_file = NamedTempFile::new_in(parent)
        .map_err(|e| format!("Failed to create temporary project file: {}", e))?;

    {
        let mut zip_writer = ZipWriter::new(temp_file.as_file_mut());

        let json_bytes = serde_json::to_vec_pretty(project)
            .map_err(|e| format!("Failed to serialize project metadata: {}", e))?;
        zip_writer
            .start_file(
                "project.json",
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
            )
            .map_err(|e| format!("Failed to start project.json entry: {}", e))?;
        zip_writer
            .write_all(&json_bytes)
            .map_err(|e| format!("Failed to write project.json: {}", e))?;

        for drawing in &project.drawings {
            let bytes = &drawings_map[&drawing.id];
            zip_writer
                .start_file(
                    &drawing.archive_path,
                    SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
                )
                .map_err(|e| format!("Failed to start drawing PDF entry: {}", e))?;
            zip_writer
                .write_all(bytes)
                .map_err(|e| format!("Failed to write drawing PDF bytes: {}", e))?;
        }

        zip_writer
            .finish()
            .map_err(|e| format!("Failed to finalize .dmone archive: {}", e))?;
    }

    temp_file
        .as_file()
        .sync_all()
        .map_err(|e| format!("Failed to flush project file to disk: {}", e))?;

    temp_file.persist(path).map_err(|e| {
        format!(
            "Failed to save project file '{}': {}",
            path.display(),
            e.error
        )
    })?;

    Ok(())
}

pub fn read_dmone(path: &Path) -> Result<(ProjectData, HashMap<String, Vec<u8>>), String> {
    let file = File::open(path)
        .map_err(|e| format!("Failed to open project file '{}': {}", path.display(), e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Project file is not a valid .dmone archive: {}", e))?;

    let project: ProjectData = {
        let mut json_entry = archive
            .by_name("project.json")
            .map_err(|_| "Archive is missing project.json.".to_string())?;
        let mut json_text = String::new();
        json_entry
            .read_to_string(&mut json_text)
            .map_err(|e| format!("Failed to read project.json: {}", e))?;
        serde_json::from_str(&json_text)
            .map_err(|e| format!("Invalid project.json format: {}", e))?
    };

    if project.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported .dmone schema version {} (expected {}).",
            project.schema_version, CURRENT_SCHEMA_VERSION
        ));
    }

    let mut drawings_map = HashMap::with_capacity(project.drawings.len());
    for drawing in &project.drawings {
        validate_archive_path(&drawing.archive_path)?;
        let mut pdf_bytes = Vec::new();
        {
            let mut pdf_entry = archive.by_name(&drawing.archive_path).map_err(|_| {
                format!("Archive is missing drawing '{}'.", drawing.archive_path)
            })?;
            pdf_entry
                .read_to_end(&mut pdf_bytes)
                .map_err(|e| format!("Failed to read drawing PDF: {}", e))?;
        }
        validate_pdf_bytes(&pdf_bytes)?;
        drawings_map.insert(drawing.id.clone(), pdf_bytes);
    }

    Ok((project, drawings_map))
}

#[tauri::command]
pub fn import_pdf(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<ImportedPdfPayload, String> {
    let pdf_path = Path::new(&path);
    let pdf_bytes = fs::read(pdf_path)
        .map_err(|e| format!("Failed to read PDF '{}': {}", pdf_path.display(), e))?;
    validate_pdf_bytes(&pdf_bytes)?;

    let filename = pdf_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("drawing.pdf")
        .to_string();
    let drawing_id = Uuid::new_v4().to_string();

    {
        let mut guard = state
            .drawings
            .lock()
            .map_err(|_| "Internal state lock poisoned.".to_string())?;
        guard.insert(drawing_id.clone(), pdf_bytes.clone());
    }

    Ok(ImportedPdfPayload {
        drawing_id,
        filename,
        pdf_bytes,
    })
}

#[tauri::command]
pub fn get_drawing_bytes(
    drawing_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    let guard = state
        .drawings
        .lock()
        .map_err(|_| "Internal state lock poisoned.".to_string())?;
    guard
        .get(&drawing_id)
        .cloned()
        .ok_or_else(|| format!("Drawing '{}' is not loaded in memory.", drawing_id))
}

#[tauri::command]
pub fn remove_drawing_bytes(
    drawing_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut guard = state
        .drawings
        .lock()
        .map_err(|_| "Internal state lock poisoned.".to_string())?;
    guard.remove(&drawing_id);
    Ok(())
}

#[tauri::command]
pub fn clear_drawings(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut guard = state
        .drawings
        .lock()
        .map_err(|_| "Internal state lock poisoned.".to_string())?;
    guard.clear();
    Ok(())
}

#[tauri::command]
pub fn save_project(
    path: String,
    project: ProjectData,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let snapshot = {
        let guard = state
            .drawings
            .lock()
            .map_err(|_| "Internal state lock poisoned.".to_string())?;
        guard.clone()
    };

    write_dmone_atomic(Path::new(&path), &project, &snapshot)
}

#[tauri::command]
pub fn open_project(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<OpenedProjectPayload, String> {
    let (project, drawings_map) = read_dmone(Path::new(&path))?;
    let active_drawing_id = project.drawings.first().map(|d| d.id.clone());
    let pdf_bytes = active_drawing_id
        .as_ref()
        .and_then(|id| drawings_map.get(id).cloned());

    {
        let mut guard = state
            .drawings
            .lock()
            .map_err(|_| "Internal state lock poisoned.".to_string())?;
        *guard = drawings_map;
    }

    Ok(OpenedProjectPayload {
        project,
        active_drawing_id,
        pdf_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    fn sample_pdf(tag: &str) -> Vec<u8> {
        format!("%PDF-1.7\n% {}\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n", tag).into_bytes()
    }

    fn sample_multi_drawing_project() -> (ProjectData, HashMap<String, Vec<u8>>) {
        let mut map = HashMap::new();
        map.insert("drw-1".to_string(), sample_pdf("ASM"));
        map.insert("drw-2".to_string(), sample_pdf("SUB"));

        let project = ProjectData {
            schema_version: CURRENT_SCHEMA_VERSION,
            project_id: "proj-1".to_string(),
            name: "C-Cover-Assembly".to_string(),
            created_at: "2026-11-25T07:00:00Z".to_string(),
            updated_at: "2026-11-25T07:15:00Z".to_string(),
            parts: vec![
                Part {
                    id: "part-1".to_string(),
                    parent_id: None,
                    name: "C-Cover Assembly".to_string(),
                    part_number: "M1292339".to_string(),
                    revision: "Rev B".to_string(),
                    notes: String::new(),
                    drawing_ids: vec!["drw-1".to_string()],
                },
                Part {
                    id: "part-2".to_string(),
                    parent_id: Some("part-1".to_string()),
                    name: "Metal C-Cover".to_string(),
                    part_number: "M1292340".to_string(),
                    revision: "Rev A".to_string(),
                    notes: "CNC machined".to_string(),
                    drawing_ids: vec!["drw-2".to_string()],
                },
            ],
            drawings: vec![
                DrawingEntry {
                    id: "drw-1".to_string(),
                    filename: "c_cover_asm.pdf".to_string(),
                    archive_path: "drawings/drw-1.pdf".to_string(),
                    page_count: 10,
                },
                DrawingEntry {
                    id: "drw-2".to_string(),
                    filename: "metal_c_cover.pdf".to_string(),
                    archive_path: "drawings/drw-2.pdf".to_string(),
                    page_count: 4,
                },
            ],
            dimensions: vec![
                Dimension {
                    id: "dim-1".to_string(),
                    drawing_id: Some("drw-1".to_string()),
                    balloon_number: 1,
                    dimension_type: "CTF".to_string(),
                    name: "103".to_string(),
                    quantity: 3,
                    nominal: "25.00".to_string(),
                    upper_tol: "+0.05".to_string(),
                    lower_tol: "-0.05".to_string(),
                    unit: "mm".to_string(),
                    notes: "Critical mating surface".to_string(),
                    marker: Some(MarkerPosition {
                        drawing_id: "drw-1".to_string(),
                        page: 1,
                        x: 0.4125,
                        y: 0.3082,
                        width: 0.08,
                        height: 0.035,
                    }),
                },
                Dimension {
                    id: "dim-2".to_string(),
                    drawing_id: Some("drw-2".to_string()),
                    balloon_number: 1,
                    dimension_type: String::new(),
                    name: "101".to_string(),
                    quantity: 1,
                    nominal: "4.20".to_string(),
                    upper_tol: "+0.02".to_string(),
                    lower_tol: "-0.00".to_string(),
                    unit: "mm".to_string(),
                    notes: String::new(),
                    marker: None,
                },
            ],
        };
        (project, map)
    }

    #[test]
    fn test_validate_pdf_bytes_accepts_valid_header_and_rejects_invalid() {
        assert!(validate_pdf_bytes(&sample_pdf("ok")).is_ok());
        assert!(validate_pdf_bytes(&[]).is_err());
        assert!(validate_pdf_bytes(b"not a pdf").is_err());
    }

    #[test]
    fn test_dmone_round_trip_supports_zero_and_multiple_drawings_with_parts() {
        let dir = tempdir().unwrap();

        // Zero-drawing project (New Project before attaching PDFs)
        let empty_path = dir.path().join("empty.dmone");
        let empty_project = ProjectData {
            schema_version: CURRENT_SCHEMA_VERSION,
            project_id: "proj-empty".to_string(),
            name: "Draft BOM".to_string(),
            created_at: "2026-11-25T07:00:00Z".to_string(),
            updated_at: "2026-11-25T07:00:00Z".to_string(),
            parts: vec![Part {
                id: "p-1".to_string(),
                parent_id: None,
                name: "Top Assembly".to_string(),
                part_number: String::new(),
                revision: String::new(),
                notes: String::new(),
                drawing_ids: vec![],
            }],
            drawings: vec![],
            dimensions: vec![],
        };
        let empty_map = HashMap::new();
        write_dmone_atomic(&empty_path, &empty_project, &empty_map).unwrap();
        let (loaded_empty, loaded_empty_map) = read_dmone(&empty_path).unwrap();
        assert_eq!(loaded_empty, empty_project);
        assert!(loaded_empty_map.is_empty());

        // Multi-drawing project with nested parts
        let multi_path = dir.path().join("assembly.dmone");
        let (project, map) = sample_multi_drawing_project();
        write_dmone_atomic(&multi_path, &project, &map).unwrap();
        let (loaded_project, loaded_map) = read_dmone(&multi_path).unwrap();
        assert_eq!(loaded_project, project);
        assert_eq!(loaded_map, map);
    }

    #[test]
    fn test_atomic_save_overwrites_existing_and_leaves_no_temp_files() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("overwrite.dmone");
        let (mut project, map) = sample_multi_drawing_project();

        write_dmone_atomic(&file_path, &project, &map).unwrap();

        project.dimensions[0].nominal = "30.00".to_string();
        write_dmone_atomic(&file_path, &project, &map).unwrap();

        let (loaded_project, loaded_map) = read_dmone(&file_path).unwrap();
        assert_eq!(loaded_project, project);
        assert_eq!(loaded_map, map);

        let entries: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(entries, vec!["overwrite.dmone".to_string()]);
    }

    #[test]
    fn test_read_dmone_backward_compatible_with_milestone1_archive() {
        let dir = tempdir().unwrap();
        let legacy_path = dir.path().join("legacy_m1.dmone");
        let legacy_json = r#"{
          "schemaVersion": 1,
          "projectId": "legacy-1",
          "name": "LegacyPart",
          "createdAt": "2026-11-25T07:00:00Z",
          "updatedAt": "2026-11-25T07:05:00Z",
          "drawings": [
            {
              "id": "drw-legacy",
              "filename": "legacy.pdf",
              "archivePath": "drawings/drw-legacy.pdf",
              "pageCount": 2
            }
          ],
          "dimensions": [
            {
              "id": "d-1",
              "balloonNumber": 1,
              "name": "101",
              "nominal": "10.00",
              "upperTol": "+0.05",
              "lowerTol": "-0.05",
              "unit": "mm",
              "notes": "",
              "marker": {
                "drawingId": "drw-legacy",
                "page": 1,
                "x": 0.5,
                "y": 0.5
              }
            }
          ]
        }"#;

        {
            let mut z = ZipWriter::new(File::create(&legacy_path).unwrap());
            z.start_file("project.json", SimpleFileOptions::default())
                .unwrap();
            z.write_all(legacy_json.as_bytes()).unwrap();
            z.start_file(
                "drawings/drw-legacy.pdf",
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .unwrap();
            z.write_all(&sample_pdf("LEGACY")).unwrap();
            z.finish().unwrap();
        }

        let (loaded, map) = read_dmone(&legacy_path).unwrap();
        assert!(loaded.parts.is_empty());
        assert_eq!(loaded.drawings.len(), 1);
        assert_eq!(loaded.dimensions[0].drawing_id, None);
        assert_eq!(loaded.dimensions[0].quantity, 1);
        assert!(map.contains_key("drw-legacy"));
    }

    #[test]
    fn test_read_dmone_rejects_corrupt_zip_missing_entries_bad_version_and_unsafe_path() {
        let dir = tempdir().unwrap();

        // (a) Corrupt ZIP
        let corrupt = dir.path().join("corrupt.dmone");
        fs::write(&corrupt, b"not a zip").unwrap();
        assert!(read_dmone(&corrupt).is_err());

        // (b) Missing project.json
        let no_json = dir.path().join("no_json.dmone");
        {
            let mut z = ZipWriter::new(File::create(&no_json).unwrap());
            z.start_file(
                "drawings/drw-1.pdf",
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .unwrap();
            z.write_all(&sample_pdf("x")).unwrap();
            z.finish().unwrap();
        }
        assert!(read_dmone(&no_json).is_err());

        // (c) Unsupported schemaVersion
        let bad_ver = dir.path().join("bad_ver.dmone");
        let (mut p_bad_ver, _) = sample_multi_drawing_project();
        p_bad_ver.schema_version = 99;
        {
            let mut z = ZipWriter::new(File::create(&bad_ver).unwrap());
            z.start_file("project.json", SimpleFileOptions::default())
                .unwrap();
            z.write_all(serde_json::to_string(&p_bad_ver).unwrap().as_bytes())
                .unwrap();
            z.finish().unwrap();
        }
        assert!(read_dmone(&bad_ver).is_err());

        // (d) Unsafe archivePath traversal
        let traversal = dir.path().join("traversal.dmone");
        let (mut p_trav, _) = sample_multi_drawing_project();
        p_trav.drawings[0].archive_path = "../evil.pdf".to_string();
        {
            let mut z = ZipWriter::new(File::create(&traversal).unwrap());
            z.start_file("project.json", SimpleFileOptions::default())
                .unwrap();
            z.write_all(serde_json::to_string(&p_trav).unwrap().as_bytes())
                .unwrap();
            z.finish().unwrap();
        }
        assert!(read_dmone(&traversal).is_err());
    }

    #[test]
    fn test_write_dmone_rejects_missing_cached_drawing_bytes() {
        let dir = tempdir().unwrap();
        let out = dir.path().join("missing_bytes.dmone");
        let (project, mut map) = sample_multi_drawing_project();
        map.remove("drw-2");
        assert!(write_dmone_atomic(&out, &project, &map).is_err());
    }
}
