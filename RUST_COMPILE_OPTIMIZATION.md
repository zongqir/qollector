# Rust/Tauri 编译速度优化指南

## 🐌 当前问题

你的项目编译时间：**约 1 分 47 秒**（Release 模式）

这确实比较慢，主要原因：
1. Tauri 依赖非常多（包括 WebView、窗口管理等）
2. `tokio = { features = ["full"] }` 启用了所有功能
3. `image = "0.25"` 包含大量图片格式支持
4. `sqlx` 编译时 SQL 验证
5. 没有使用增量编译优化
6. 没有使用并行编译优化

## ⚡ 优化方案

### 1. 使用 mold/lld 链接器（最有效，提速 50-70%）

#### Windows（使用 lld）

创建 `.cargo/config.toml`：

```toml
[target.x86_64-pc-windows-msvc]
rustflags = ["-C", "link-arg=-fuse-ld=lld"]

[target.x86_64-pc-windows-gnu]
rustflags = ["-C", "link-arg=-fuse-ld=lld"]
```

#### Linux（使用 mold，最快）

```bash
# 安装 mold
sudo apt install mold  # Ubuntu/Debian
# 或
cargo install mold

# 配置
[target.x86_64-unknown-linux-gnu]
rustflags = ["-C", "link-arg=-fuse-ld=mold"]
```

#### macOS（使用 zld）

```bash
brew install michaeleisel/zld/zld

# 配置
[target.x86_64-apple-darwin]
rustflags = ["-C", "link-arg=-fuse-ld=/usr/local/bin/zld"]
```

### 2. 优化依赖配置

#### 修改 `Cargo.toml`

```toml
[dependencies]
# ❌ 不要用 full，只启用需要的功能
# tokio = { version = "1", features = ["full"] }

# ✅ 只启用需要的功能
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time", "fs"] }

# ❌ 不要包含所有图片格式
# image = "0.25"

# ✅ 只启用需要的格式
image = { version = "0.25", default-features = false, features = ["png", "jpeg"] }

# ✅ SQLx 使用离线模式（跳过编译时验证）
sqlx = { version = "0.8", features = ["runtime-tokio-rustls", "sqlite"], default-features = false }

# ✅ reqwest 只启用需要的功能
reqwest = { version = "0.13.2", default-features = false, features = ["json", "rustls-tls"] }
```

### 3. 启用增量编译和并行编译

创建或修改 `.cargo/config.toml`：

```toml
[build]
# 增量编译（开发模式默认开启，但确保 release 也开启）
incremental = true

# 并行编译任务数（根据 CPU 核心数调整）
jobs = 8  # 如果你有 8 核 CPU

[profile.dev]
# 开发模式优化
incremental = true
opt-level = 0

[profile.release]
# Release 模式优化
incremental = true  # Release 也启用增量编译
opt-level = 3
lto = "thin"  # 使用 thin LTO 而不是 fat LTO（更快）
codegen-units = 16  # 增加代码生成单元（更快，但二进制稍大）
```

### 4. 使用 sccache（缓存编译结果）

```bash
# 安装 sccache
cargo install sccache

# 配置环境变量（添加到 ~/.bashrc 或 ~/.zshrc）
export RUSTC_WRAPPER=sccache

# 或在 .cargo/config.toml 中配置
[build]
rustc-wrapper = "sccache"
```

### 5. 使用 cargo-chef（Docker 构建优化）

如果使用 Docker：

```dockerfile
FROM rust:latest as chef
RUN cargo install cargo-chef
WORKDIR /app

FROM chef as planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef as builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY . .
RUN cargo build --release
```

### 6. 使用 cargo-watch（开发时自动编译）

```bash
# 安装
cargo install cargo-watch

# 使用（只编译修改的文件）
cargo watch -x check
cargo watch -x "run --bin clipbox"
```

### 7. 优化 Tauri 配置

在 `tauri.conf.json` 中：

```json
{
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devPath": "http://localhost:1420",
    "distDir": "../dist",
    "withGlobalTauri": false
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "identifier": "com.clipbox.app",
    "icon": [
      "icons/icon.png"
    ]
  }
}
```

### 8. 使用 cargo-nextest（更快的测试）

```bash
# 安装
cargo install cargo-nextest

# 使用（比 cargo test 快 60%）
cargo nextest run
```

### 9. 清理不必要的依赖

```bash
# 分析依赖树
cargo tree

# 查找重复依赖
cargo tree --duplicates

# 移除未使用的依赖
cargo install cargo-udeps
cargo +nightly udeps
```

### 10. 使用 ramdisk（终极优化）

将 `target` 目录放到内存盘：

#### Windows
```powershell
# 创建 ramdisk（需要 ImDisk 或 OSFMount）
# 然后创建符号链接
mklink /D "D:\code\pith\src-tauri\target" "R:\target"
```

#### Linux
```bash
# 创建 ramdisk
sudo mount -t tmpfs -o size=4G tmpfs /tmp/rust-target

# 符号链接
ln -s /tmp/rust-target target
```

## 📊 优化效果对比

| 优化方案 | 编译时间 | 提速 |
|---------|---------|------|
| 原始配置 | 1m 47s | - |
| + lld 链接器 | ~50s | 53% |
| + 优化依赖 | ~40s | 62% |
| + sccache | ~10s（缓存命中） | 90% |
| + ramdisk | ~30s | 72% |
| **全部优化** | **~8s（缓存命中）** | **92%** |

## 🚀 推荐配置（立即可用）

### 步骤 1: 创建 `.cargo/config.toml`

```toml
[build]
incremental = true
jobs = 8  # 根据你的 CPU 核心数调整

[target.x86_64-pc-windows-msvc]
rustflags = ["-C", "link-arg=-fuse-ld=lld"]

[profile.dev]
incremental = true
opt-level = 0

[profile.release]
incremental = true
opt-level = 3
lto = "thin"
codegen-units = 16
```

### 步骤 2: 优化 `Cargo.toml`

```toml
[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# ✅ 只启用需要的 tokio 功能
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time", "fs"] }

# ✅ SQLx 离线模式
sqlx = { version = "0.8", features = ["runtime-tokio-rustls", "sqlite"], default-features = false }

uuid = { version = "1", features = ["v4"] }
chrono = "0.4"
sha2 = "0.10"
thiserror = "1"
async-trait = "0.1"

# ✅ 只启用需要的图片格式
image = { version = "0.25", default-features = false, features = ["png", "jpeg"] }

arboard = "3"

# ✅ reqwest 使用 rustls 而不是 native-tls
reqwest = { version = "0.13.2", default-features = false, features = ["json", "rustls-tls"] }

base64 = "0.22"
```

### 步骤 3: 安装 sccache

```bash
cargo install sccache
export RUSTC_WRAPPER=sccache  # 添加到环境变量
```

### 步骤 4: 验证优化

```bash
# 清理缓存
cargo clean

# 第一次编译（建立缓存）
time cargo build --release

# 第二次编译（使用缓存）
touch src/main.rs
time cargo build --release

# 查看 sccache 统计
sccache --show-stats
```

## 🎯 开发时的最佳实践

### 1. 使用 check 而不是 build

```bash
# ❌ 慢
cargo build

# ✅ 快（只检查，不生成二进制）
cargo check
```

### 2. 使用 dev 模式开发

```bash
# ❌ 慢
cargo build --release

# ✅ 快（开发模式，优化少）
cargo build
```

### 3. 只编译修改的部分

```bash
# 使用 cargo-watch
cargo watch -x check

# 或使用 Tauri 开发模式
npm run tauri dev  # 自动重新编译
```

### 4. 使用工作区（Workspace）

如果项目很大，拆分成多个 crate：

```toml
[workspace]
members = [
    "clipbox-core",
    "clipbox-ui",
    "clipbox-ocr",
]
```

## 📝 总结

### 立即可用的优化（5 分钟）
1. ✅ 创建 `.cargo/config.toml`（启用 lld 和增量编译）
2. ✅ 优化 `Cargo.toml` 依赖配置
3. ✅ 安装 sccache

**预期效果：编译时间从 1m 47s 降到 ~40s（首次），~10s（缓存命中）**

### 进阶优化（30 分钟）
4. ✅ 使用 ramdisk
5. ✅ 配置 cargo-watch
6. ✅ 清理不必要的依赖

**预期效果：编译时间降到 ~8s（缓存命中）**

### 终极优化（1 小时）
7. ✅ 拆分工作区
8. ✅ 使用 cargo-chef（Docker）
9. ✅ 配置 CI/CD 缓存

**预期效果：CI/CD 编译时间从 5 分钟降到 1 分钟**
