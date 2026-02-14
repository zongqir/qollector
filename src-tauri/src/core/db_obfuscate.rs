use std::path::Path;
use std::fs::OpenOptions;
use std::io::{Read, Write, Seek, SeekFrom};

const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
const CLIPBOX_MAGIC: &[u8; 16] = b"CLIPBOX_DB\0\0\0\0\0\0";

/// 启动时：恢复 SQLite header
pub fn deobfuscate_db(db_path: &Path) {
    if !db_path.exists() { return; }
    let mut f = OpenOptions::new().read(true).write(true).open(db_path).expect("无法打开数据库");
    let mut h = [0u8; 16];
    if f.read_exact(&mut h).is_ok() && h == *CLIPBOX_MAGIC {
        f.seek(SeekFrom::Start(0)).unwrap();
        f.write_all(SQLITE_MAGIC).unwrap();
        f.flush().unwrap();
    }
}

/// 退出时：覆盖为自定义 magic
pub fn obfuscate_db(db_path: &Path) {
    if !db_path.exists() { return; }
    let mut f = OpenOptions::new().read(true).write(true).open(db_path).expect("无法打开数据库");
    let mut h = [0u8; 16];
    if f.read_exact(&mut h).is_ok() && h == *SQLITE_MAGIC {
        f.seek(SeekFrom::Start(0)).unwrap();
        f.write_all(CLIPBOX_MAGIC).unwrap();
        f.flush().unwrap();
    }
}
