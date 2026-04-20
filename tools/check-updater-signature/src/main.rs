use std::{env, fs, process};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct TauriConf {
    plugins: Plugins,
}

#[derive(Debug, Deserialize)]
struct Plugins {
    updater: UpdaterPlugin,
}

#[derive(Debug, Deserialize)]
struct UpdaterPlugin {
    pubkey: String,
}

fn fail(message: impl AsRef<str>) -> ! {
    eprintln!("{}", message.as_ref());
    process::exit(1);
}

fn main() {
    let mut args = env::args().skip(1);
    let file_path = args
        .next()
        .unwrap_or_else(|| fail("usage: check-updater-signature <file> <sig> <tauri.conf.json>"));
    let signature_path = args
        .next()
        .unwrap_or_else(|| fail("usage: check-updater-signature <file> <sig> <tauri.conf.json>"));
    let tauri_conf_path = args
        .next()
        .unwrap_or_else(|| fail("usage: check-updater-signature <file> <sig> <tauri.conf.json>"));

    if args.next().is_some() {
        fail("usage: check-updater-signature <file> <sig> <tauri.conf.json>");
    }

    let tauri_conf_raw = fs::read_to_string(&tauri_conf_path)
        .unwrap_or_else(|err| fail(format!("failed to read {}: {err}", tauri_conf_path)));
    let tauri_conf: TauriConf = serde_json::from_str(&tauri_conf_raw)
        .unwrap_or_else(|err| fail(format!("failed to parse {}: {err}", tauri_conf_path)));

    let pubkey_text = STANDARD
        .decode(tauri_conf.plugins.updater.pubkey.trim())
        .unwrap_or_else(|err| fail(format!("failed to decode updater pubkey from tauri.conf.json: {err}")));
    let pubkey_text = String::from_utf8(pubkey_text)
        .unwrap_or_else(|err| fail(format!("updater pubkey is not valid utf-8: {err}")));

    let public_key = PublicKey::decode(&pubkey_text)
        .unwrap_or_else(|err| fail(format!("failed to parse updater pubkey: {err}")));
    let signature_raw = fs::read_to_string(&signature_path)
        .unwrap_or_else(|err| fail(format!("failed to read minisign signature {}: {err}", signature_path)));
    let signature_text = STANDARD
        .decode(signature_raw.trim())
        .unwrap_or_else(|err| fail(format!("failed to decode minisign signature from {}: {err}", signature_path)));
    let signature_text = String::from_utf8(signature_text)
        .unwrap_or_else(|err| fail(format!("decoded minisign signature is not valid utf-8: {err}")));
    let signature = Signature::decode(&signature_text)
        .unwrap_or_else(|err| fail(format!("failed to parse minisign signature {}: {err}", signature_path)));
    let payload =
        fs::read(&file_path).unwrap_or_else(|err| fail(format!("failed to read {}: {err}", file_path)));

    public_key.verify(&payload, &signature, true).unwrap_or_else(|err| {
        fail(format!(
            "updater signing key mismatch: secret key can sign, but tauri.conf.json pubkey cannot verify it: {err}"
        ))
    });

    println!("Updater signing key matches tauri.conf.json pubkey.");
}
