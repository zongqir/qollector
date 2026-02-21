#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use std::path::PathBuf;
#[cfg(target_os = "windows")]
use std::sync::mpsc;

#[cfg(target_os = "windows")]
use tauri::{AppHandle, WebviewWindow};

#[cfg(target_os = "windows")]
use drag::{start_drag, DragItem, DragMode, Image, Options};

#[cfg(target_os = "windows")]
use super::drag_out::{DragOutError, DragOutOperation, DragOutRequest, PlatformDragOut};

pub struct WindowsDragOutBackend;

impl WindowsDragOutBackend {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(target_os = "windows")]
fn to_wide(s: &std::ffi::OsStr) -> Vec<u16> {
    s.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn create_shortcut(target: &std::path::Path, lnk_path: &std::path::Path) -> Result<(), DragOutError> {
    use windows::core::{Interface, GUID, PCWSTR};
    use windows::Win32::System::Com::*;
    use windows::Win32::UI::Shell::IShellLinkW;

    const CLSID_SHELL_LINK: GUID =
        GUID::from_u128(0x00021401_0000_0000_C000_000000000046);

    let target_wide = to_wide(target.as_os_str());
    let lnk_wide = to_wide(lnk_path.as_os_str());

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let shell_link: IShellLinkW =
            CoCreateInstance(&CLSID_SHELL_LINK, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| DragOutError::Native(format!("create ShellLink: {e}")))?;
        shell_link
            .SetPath(PCWSTR(target_wide.as_ptr()))
            .map_err(|e| DragOutError::Native(format!("SetPath: {e}")))?;

        let persist: IPersistFile = shell_link
            .cast()
            .map_err(|e| DragOutError::Native(format!("cast IPersistFile: {e}")))?;

        persist
            .Save(PCWSTR(lnk_wide.as_ptr()), true)
            .map_err(|e| DragOutError::Native(format!("Save lnk: {e}")))?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn create_link_files(paths: &[PathBuf]) -> Result<Vec<PathBuf>, DragOutError> {
    let temp_dir = std::env::temp_dir().join("clipbox_drag_links");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| DragOutError::Native(format!("create temp dir: {e}")))?;

    let mut lnk_paths = Vec::with_capacity(paths.len());
    for path in paths {
        let stem = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy();
        let lnk_name = format!("{}.lnk", stem);
        let lnk_path = temp_dir.join(&lnk_name);
        create_shortcut(path, &lnk_path)?;
        lnk_paths.push(lnk_path);
    }
    Ok(lnk_paths)
}

#[cfg(target_os = "windows")]
impl PlatformDragOut for WindowsDragOutBackend {
    fn start_file_drag(
        &self,
        app: AppHandle,
        window: WebviewWindow,
        request: DragOutRequest,
    ) -> Result<(), DragOutError> {
        if request.paths.is_empty() {
            return Err(DragOutError::EmptyPaths);
        }

        let mut valid_paths: Vec<PathBuf> = Vec::with_capacity(request.paths.len());
        for path in &request.paths {
            if !path.exists() {
                return Err(DragOutError::MissingPath(path.display().to_string()));
            }
            valid_paths.push(path.clone());
        }

        let is_link = matches!(request.operation, DragOutOperation::Link);
        let drag_paths = if is_link {
            create_link_files(&valid_paths)?
        } else {
            valid_paths
        };

        let drag_mode = match request.operation {
            DragOutOperation::Copy | DragOutOperation::Link => DragMode::Copy,
            DragOutOperation::Move => DragMode::Move,
        };

        let (tx, rx) = mpsc::sync_channel::<Result<(), DragOutError>>(1);
        app.run_on_main_thread(move || {
            let image = Image::Raw(vec![0, 0, 0, 0]);
            let options = Options {
                skip_animatation_on_cancel_or_failure: true,
                mode: drag_mode,
            };

            let result = start_drag(
                &window,
                DragItem::Files(drag_paths),
                image,
                |_result, _cursor_position| {},
                options,
            )
            .map_err(|e| DragOutError::Native(e.to_string()));

            let _ = tx.send(result);
        })
        .map_err(|e| DragOutError::MainThread(e.to_string()))?;

        rx.recv()
            .map_err(|e| DragOutError::Native(format!("failed to receive drag result: {e}")))??;

        Ok(())
    }
}
