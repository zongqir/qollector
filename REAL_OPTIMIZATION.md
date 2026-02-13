# Rust 编译速度真实优化指南

## 现状分析

你的项目编译慢的根本原因：
- **900 个依赖包**（Tauri 框架本身就很重）
- **大量重复版本**（同一个库的多个版本都要编译）
- **Windows 平台**（比 Linux 慢 2-3 倍）
- **首次编译**（无缓存可用）

**24 分钟的首次 Release 编译在 Windows 上是正常的。**

## 已应用的优化（有限效果）

✅ 优化了依赖 features（减少 20-30%）
✅ 启用增量编译
✅ 使用 lld 链接器
✅ 并行编译（8 核）

**预期效果：** 从 24 分钟降到 ~15-18 分钟（首次编译）

## 真正有效的优化

### 1. 避免完全重新编译（最重要！）

```bash
# ❌ 永远不要这样做（除非必要）
cargo clean
cargo build --release  # 24 分钟

# ✅ 增量编译（已配置）
# 修改代码后直接编译
cargo build --release  # 只需 10-30 秒
```

**关键：** 不要运行 `cargo clean`，让增量编译发挥作用。

### 2. 开发时使用 Dev 模式

```bash
# ❌ 开发时不要用 Release（慢）
cargo build --release  # 24 分钟

# ✅ 开发时用 Debug 模式（快 3 倍）
cargo build  # 8 分钟（首次）
cargo build  # 10-30 秒（增量）

# ✅ 只检查语法（快 5 倍）
cargo check  # 3 分钟（首次）
cargo check  # 5-10 秒（增量）
```

### 3. 使用 Tauri 开发模式

```bash
# ✅ 自动增量编译
npm run tauri dev

# 首次启动：~8 分钟
# 修改代码后：10-30 秒自动重新编译
```

### 4. 只在发布前编译 Release

```bash
# 开发阶段：使用 dev 模式
npm run tauri dev

# 准备发布：才编译 release
cargo build --release  # 只在发布前做一次
```

## 编译时间对比

| 场景 | 时间 | 说明 |
|------|------|------|
| 首次 Release（clean） | 24 分钟 | 正常 |
| 首次 Debug（clean） | 8 分钟 | 开发用这个 |
| 增量 Release | 10-30 秒 | 修改代码后 |
| 增量 Debug | 5-15 秒 | 修改代码后 |
| cargo check | 3-10 秒 | 只检查语法 |

## 为什么 sccache 装不上？

sccache 0.14.0 和 0.8.2 在 Windows 上有编译错误：
```
error: unresolved import `windows_sys::Win32::System::Threading::CreateProcessW`
```

这是 sccache 项目的 bug，不是你的问题。

**替代方案：** 依赖增量编译（已配置），效果类似。

## 减少依赖数量（治本）

### 查找未使用的依赖

```bash
# 安装工具
cargo install cargo-udeps

# 查找未使用的依赖
cargo +nightly udeps
```

### 分析依赖树

```bash
# 查看哪些依赖最重
cargo tree --depth 1

# 查找重复依赖
cargo tree --duplicates
```

### 考虑替换重量级依赖

| 当前依赖 | 替代方案 | 效果 |
|---------|---------|------|
| sqlx | rusqlite | 编译快 5 倍 |
| reqwest | ureq | 编译快 3 倍 |
| image | 只用 png/jpeg 解码器 | 已优化 |

**注意：** 替换依赖需要重写代码，权衡成本。

## 使用工作区（Workspace）

如果项目继续增长，拆分成多个 crate：

```toml
# Cargo.toml（根目录）
[workspace]
members = [
    "clipbox-core",    # 核心逻辑
    "clipbox-ui",      # UI 相关
    "clipbox-ocr",     # OCR 功能
]
```

**好处：** 只重新编译修改的 crate。

## 终极方案：使用 Linux

在 Linux 上编译 Rust 比 Windows 快 2-3 倍：

```bash
# Windows（lld 链接器）
cargo build --release  # 24 分钟

# Linux（mold 链接器）
cargo build --release  # 8-10 分钟
```

**建议：** 如果经常需要完全重新编译，考虑使用 WSL2 或 Linux 虚拟机。

## 实用建议

### 日常开发流程

```bash
# 1. 启动开发服务器（首次 8 分钟）
npm run tauri dev

# 2. 修改代码
# 3. 自动重新编译（10-30 秒）
# 4. 测试

# 5. 准备发布时才编译 release
cargo build --release
```

### 避免的操作

```bash
# ❌ 不要频繁 clean
cargo clean

# ❌ 不要在开发时用 release
cargo build --release

# ❌ 不要每次都完全重新编译
```

### 推荐的操作

```bash
# ✅ 使用 check 检查语法
cargo check

# ✅ 使用 dev 模式开发
npm run tauri dev

# ✅ 利用增量编译
# 直接 cargo build，不要 clean
```

## 总结

**核心观点：**
1. 24 分钟首次编译是正常的（Tauri + 900 个依赖）
2. 增量编译只需 10-30 秒（已配置）
3. 开发时用 dev 模式，不要用 release
4. 不要频繁运行 cargo clean
5. sccache 在 Windows 上装不上是正常的

**最有效的优化：**
- ✅ 使用增量编译（已配置）
- ✅ 开发时用 `npm run tauri dev`
- ✅ 避免 `cargo clean`
- ✅ 只在发布前编译 release

**不要纠结首次编译时间，关注增量编译速度。**
