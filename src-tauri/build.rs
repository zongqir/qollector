fn main() {
    // Skip icon for now
    println!("cargo:rustc-env=TAURI_SKIP_EMBEDDED_RESOURCES=true");

    tauri_build::build()
}
