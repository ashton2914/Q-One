use serde::{Deserialize, Serialize};
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

fn default_quantity() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Dimension {
    pub id: String,
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
    pub drawings: Vec<DrawingEntry>,
    pub dimensions: Vec<Dimension>,
}

#[derive(Debug, Clone)]
pub struct CachedDrawing {
    pub drawing_id: String,
    pub bytes: Vec<u8>,
}

#[derive(Default)]
pub struct AppState {
    pub active_drawing: Mutex<Option<CachedDrawing>>,
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
    pub pdf_bytes: Vec<u8>,
}

pub fn validate_pdf_bytes(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 5 || !bytes.starts_with(b"%PDF-") {
        return Err("Selected file is not a valid PDF document (missing %PDF- header).".to_string());
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
    pdf_bytes: &[u8],
) -> Result<(), String> {
    if project.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported project schema version: {}",
            project.schema_version
        ));
    }
    if project.drawings.len() != 1 {
        return Err("Project must contain exactly one drawing in Milestone 1.".to_string());
    }
    validate_pdf_bytes(pdf_bytes)?;

    let drawing = &project.drawings[0];
    validate_archive_path(&drawing.archive_path)?;

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

        zip_writer
            .start_file(
                &drawing.archive_path,
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .map_err(|e| format!("Failed to start drawing PDF entry: {}", e))?;
        zip_writer
            .write_all(pdf_bytes)
            .map_err(|e| format!("Failed to write drawing PDF bytes: {}", e))?;

        zip_writer
            .finish()
            .map_err(|e| format!("Failed to finalize .dmone archive: {}", e))?;
    }

    temp_file
        .as_file()
        .sync_all()
        .map_err(|e| format!("Failed to flush project file to disk: {}", e))?;

    temp_file
        .persist(path)
        .map_err(|e| format!("Failed to save project file '{}': {}", path.display(), e.error))?;

    Ok(())
}

pub fn read_dmone(path: &Path) -> Result<(ProjectData, Vec<u8>), String> {
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
    if project.drawings.is_empty() {
        return Err("Project archive contains no drawings.".to_string());
    }

    let drawing = &project.drawings[0];
    validate_archive_path(&drawing.archive_path)?;

    let mut pdf_bytes = Vec::new();
    {
        let mut pdf_entry = archive
            .by_name(&drawing.archive_path)
            .map_err(|_| format!("Archive is missing drawing '{}'.", drawing.archive_path))?;
        pdf_entry
            .read_to_end(&mut pdf_bytes)
            .map_err(|e| format!("Failed to read drawing PDF: {}", e))?;
    }

    validate_pdf_bytes(&pdf_bytes)?;
    Ok((project, pdf_bytes))
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
            .active_drawing
            .lock()
            .map_err(|_| "Internal state lock poisoned.".to_string())?;
        *guard = Some(CachedDrawing {
            drawing_id: drawing_id.clone(),
            bytes: pdf_bytes.clone(),
        });
    }

    Ok(ImportedPdfPayload {
        drawing_id,
        filename,
        pdf_bytes,
    })
}

#[tauri::command]
pub fn save_project(
    path: String,
    project: ProjectData,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let cached = {
        let guard = state
            .active_drawing
            .lock()
            .map_err(|_| "Internal state lock poisoned.".to_string())?;
        guard.clone()
    };

    let cached = cached.ok_or_else(|| "No PDF drawing is currently loaded.".to_string())?;
    if let Some(first) = project.drawings.first() {
        if first.id != cached.drawing_id {
            return Err("Loaded PDF does not match the active project's drawing ID.".to_string());
        }
    }

    write_dmone_atomic(Path::new(&path), &project, &cached.bytes)
}

#[tauri::command]
pub fn open_project(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<OpenedProjectPayload, String> {
    let (project, pdf_bytes) = read_dmone(Path::new(&path))?;
    let drawing_id = project.drawings[0].id.clone();

    {
        let mut guard = state
            .active_drawing
            .lock()
            .map_err(|_| "Internal state lock poisoned.".to_string())?;
        *guard = Some(CachedDrawing {
            drawing_id,
            bytes: pdf_bytes.clone(),
        });
    }

    Ok(OpenedProjectPayload { project, pdf_bytes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    fn sample_pdf() -> Vec<u8> {
        b"%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n".to_vec()
    }

    fn sample_project(drawing_id: &str) -> ProjectData {
        ProjectData {
            schema_version: CURRENT_SCHEMA_VERSION,
            project_id: "proj-1".to_string(),
            name: "Housing-RevB".to_string(),
            created_at: "2026-11-25T07:00:00Z".to_string(),
            updated_at: "2026-11-25T07:15:00Z".to_string(),
            drawings: vec![DrawingEntry {
                id: drawing_id.to_string(),
                filename: "Housing-RevB.pdf".to_string(),
                archive_path: format!("drawings/{}.pdf", drawing_id),
                page_count: 2,
            }],
            dimensions: vec![
                Dimension {
                    id: "dim-1".to_string(),
                    balloon_number: 1,
                    dimension_type: "CTQ".to_string(),
                    name: "Outer Diameter".to_string(),
                    quantity: 3,
                    nominal: "25.00".to_string(),
                    upper_tol: "+0.05".to_string(),
                    lower_tol: "-0.05".to_string(),
                    unit: "mm".to_string(),
                    notes: "Critical mating surface".to_string(),
                    marker: Some(MarkerPosition {
                        drawing_id: drawing_id.to_string(),
                        page: 1,
                        x: 0.4125,
                        y: 0.3082,
                        width: 0.08,
                        height: 0.035,
                    }),
                },
                Dimension {
                    id: "dim-2".to_string(),
                    balloon_number: 2,
                    dimension_type: String::new(),
                    name: "Slot Width".to_string(),
                    quantity: 1,
                    nominal: "4.20".to_string(),
                    upper_tol: "+0.02".to_string(),
                    lower_tol: "-0.00".to_string(),
                    unit: "mm".to_string(),
                    notes: String::new(),
                    marker: None,
                },
            ],
        }
    }

    #[test]
    fn test_validate_pdf_bytes_accepts_valid_header_and_rejects_invalid() {
        assert!(validate_pdf_bytes(&sample_pdf()).is_ok());
        assert!(validate_pdf_bytes(&[]).is_err());
        assert!(validate_pdf_bytes(b"not a pdf").is_err());
    }

    #[test]
    fn test_dmone_round_trip_preserves_project_and_pdf_bytes() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("housing.dmone");
        let project = sample_project("drw-1");
        let pdf = sample_pdf();

        write_dmone_atomic(&file_path, &project, &pdf).unwrap();
        let (loaded_project, loaded_pdf) = read_dmone(&file_path).unwrap();

        assert_eq!(loaded_project, project);
        assert_eq!(loaded_pdf, pdf);
    }

    #[test]
    fn test_atomic_save_overwrites_existing_and_leaves_no_temp_files() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("overwrite.dmone");
        let mut project = sample_project("drw-2");
        let pdf = sample_pdf();

        write_dmone_atomic(&file_path, &project, &pdf).unwrap();

        project.dimensions[0].nominal = "30.00".to_string();
        project.dimensions[1].marker = Some(MarkerPosition {
            drawing_id: "drw-2".to_string(),
            page: 2,
            x: 0.75,
            y: 0.25,
            width: 0.06,
            height: 0.03,
        });
        write_dmone_atomic(&file_path, &project, &pdf).unwrap();

        let (loaded_project, loaded_pdf) = read_dmone(&file_path).unwrap();
        assert_eq!(loaded_project, project);
        assert_eq!(loaded_pdf, pdf);

        let entries: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(entries, vec!["overwrite.dmone".to_string()]);
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
            z.write_all(&sample_pdf()).unwrap();
            z.finish().unwrap();
        }
        assert!(read_dmone(&no_json).is_err());

        // (c) Unsupported schemaVersion
        let bad_ver = dir.path().join("bad_ver.dmone");
        let mut p_bad_ver = sample_project("drw-1");
        p_bad_ver.schema_version = 99;
        {
            let mut z = ZipWriter::new(File::create(&bad_ver).unwrap());
            z.start_file("project.json", SimpleFileOptions::default()).unwrap();
            z.write_all(serde_json::to_string(&p_bad_ver).unwrap().as_bytes())
                .unwrap();
            z.start_file("drawings/drw-1.pdf", SimpleFileOptions::default())
                .unwrap();
            z.write_all(&sample_pdf()).unwrap();
            z.finish().unwrap();
        }
        assert!(read_dmone(&bad_ver).is_err());

        // (d) Empty drawings array
        let no_drawings = dir.path().join("no_drawings.dmone");
        let mut p_empty = sample_project("drw-1");
        p_empty.drawings.clear();
        {
            let mut z = ZipWriter::new(File::create(&no_drawings).unwrap());
            z.start_file("project.json", SimpleFileOptions::default()).unwrap();
            z.write_all(serde_json::to_string(&p_empty).unwrap().as_bytes())
                .unwrap();
            z.finish().unwrap();
        }
        assert!(read_dmone(&no_drawings).is_err());

        // (e) Unsafe archivePath traversal
        let traversal = dir.path().join("traversal.dmone");
        let mut p_trav = sample_project("drw-1");
        p_trav.drawings[0].archive_path = "../evil.pdf".to_string();
        {
            let mut z = ZipWriter::new(File::create(&traversal).unwrap());
            z.start_file("project.json", SimpleFileOptions::default()).unwrap();
            z.write_all(serde_json::to_string(&p_trav).unwrap().as_bytes())
                .unwrap();
            z.finish().unwrap();
        }
        assert!(read_dmone(&traversal).is_err());
    }
}
