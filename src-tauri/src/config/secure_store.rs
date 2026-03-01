use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

const KEY_FILE_NAME: &str = "config.master.key";
const ENVELOPE_MARKER: &str = "qollect-sealed-v1";

#[derive(Debug, Serialize, Deserialize)]
struct SealedEnvelope {
    marker: String,
    nonce: String,
    ciphertext: String,
}

fn app_data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(appdata).join("com.qollect.clipboard")
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join(".local/share/com.qollect.clipboard")
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join("Library/Application Support/com.qollect.clipboard")
    }
}

fn master_key_path() -> PathBuf {
    app_data_dir().join(KEY_FILE_NAME)
}

fn generate_master_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    key[..16].copy_from_slice(Uuid::new_v4().as_bytes());
    key[16..].copy_from_slice(Uuid::new_v4().as_bytes());
    key
}

fn load_or_create_master_key() -> Result<[u8; 32], String> {
    let key_path = master_key_path();
    if let Some(parent) = key_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建密钥目录失败: {}", e))?;
    }

    if key_path.exists() {
        let encoded = fs::read_to_string(&key_path).map_err(|e| format!("读取密钥失败: {}", e))?;
        let decoded = STANDARD
            .decode(encoded.trim())
            .map_err(|e| format!("解析密钥失败: {}", e))?;
        if decoded.len() != 32 {
            return Err("密钥长度无效".to_string());
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&decoded);
        return Ok(key);
    }

    let key = generate_master_key();
    let encoded = STANDARD.encode(key);
    fs::write(&key_path, encoded).map_err(|e| format!("写入密钥失败: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600));
    }

    Ok(key)
}

pub fn seal_json(plain_json: &str) -> Result<String, String> {
    let key = load_or_create_master_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("初始化加密器失败: {}", e))?;

    let uuid = Uuid::new_v4();
    let mut nonce_bytes = [0u8; 12];
    nonce_bytes.copy_from_slice(&uuid.as_bytes()[..12]);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plain_json.as_bytes())
        .map_err(|e| format!("加密失败: {}", e))?;

    let envelope = SealedEnvelope {
        marker: ENVELOPE_MARKER.to_string(),
        nonce: STANDARD.encode(nonce_bytes),
        ciphertext: STANDARD.encode(ciphertext),
    };

    serde_json::to_string(&envelope).map_err(|e| format!("序列化密封数据失败: {}", e))
}

pub fn unseal_json(stored: &str) -> Result<Option<String>, String> {
    let envelope = match serde_json::from_str::<SealedEnvelope>(stored) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };

    if envelope.marker != ENVELOPE_MARKER {
        return Ok(None);
    }

    let key = load_or_create_master_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("初始化解密器失败: {}", e))?;

    let nonce_vec = STANDARD
        .decode(envelope.nonce.as_bytes())
        .map_err(|e| format!("解析 nonce 失败: {}", e))?;
    if nonce_vec.len() != 12 {
        return Err("nonce 长度无效".to_string());
    }
    let nonce = Nonce::from_slice(&nonce_vec);

    let ciphertext = STANDARD
        .decode(envelope.ciphertext.as_bytes())
        .map_err(|e| format!("解析密文失败: {}", e))?;

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| format!("解密失败: {}", e))?;

    String::from_utf8(plaintext)
        .map(Some)
        .map_err(|e| format!("解密结果不是有效 UTF-8: {}", e))
}
