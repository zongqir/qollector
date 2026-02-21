fn main() {
    // Skip icon for now
    println!("cargo:rustc-env=TAURI_SKIP_EMBEDDED_RESOURCES=true");

    // Inject build timestamp for beta expiry check
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("Time went backwards")
        .as_secs();
    println!("cargo:rustc-env=BUILD_TIMESTAMP={}", now);

    tauri_build::build()
}
