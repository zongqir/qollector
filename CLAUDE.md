# CLAUDE.md

此文件为 Claude Code 在处理本仓库代码时提供指导。

## 项目概述

ClipBox 是一款现代化的跨平台剪贴板管理器，使用 Rust (Tauri v2) 和 React 构建。它的定位是面向开发者和创造者的 HUD 运行空间，而非传统的笔记本或静态展示窗。

**核心理念：**

1. 极致简洁：零配置，默认即最优。
2. 审美优先：具有深色模式、毛玻璃效果和流畅动画的现代 UI。要求绝对颜值。
3. 真正的跨平台：坚持 Linux 优先原则，在 Windows/macOS/Linux 上提供统一体验。
4. 国际化支持：支持多语言切换（简体中文、English），可轻松扩展更多语言。
5. AI 集成：支持 MCP (Model Context Protocol)，允许 AI 助手直接访问剪贴板数据。


## 构建与开发命令

### 快速开始（最常用）

```bash
# 🚀 开发模式（推荐）- 同时启动前端和后端，支持热重载
npm run tauri dev
# 或
cargo tauri dev

# 📦 生产构建 - 生成可执行文件
npm run tauri build
# 或
cargo tauri build
```

### 前端开发

```bash
# 启动 Vite 开发服务器（仅前端，不启动 Tauri）
npm run dev

# 构建前端（生成 dist 目录）
npm run build

# 预览构建结果
npm run preview
```

### 后端开发

```bash
# 仅构建 Rust 后端
cargo build --manifest-path src-tauri/Cargo.toml

# 构建整个 Tauri 应用（包含前端）
cargo tauri build

# 开发模式运行（同时启动前端和后端）
cargo tauri dev

# 清理构建缓存
cargo clean --manifest-path src-tauri/Cargo.toml
```

### 常见编译场景

#### 场景 1：日常开发调试
```bash
# 一条命令搞定，自动打开应用窗口
npm run tauri dev
```

#### 场景 2：测试前端修改
```bash
# 只启动前端，在浏览器中查看
npm run dev
# 访问 http://localhost:5173
```

#### 场景 3：打包发布
```bash
# 先安装依赖（如果是新克隆的项目）
npm install

# 构建生产版本
npm run tauri build

# 生成的可执行文件位于：
# Windows: src-tauri/target/release/clipbox.exe
# Linux: src-tauri/target/release/clipbox
# macOS: src-tauri/target/release/bundle/macos/ClipBox.app
```

#### 场景 4：清理重新编译
```bash
# 清理所有构建产物
cargo clean --manifest-path src-tauri/Cargo.toml
rm -rf dist node_modules

# 重新安装和构建
npm install
npm run tauri build
```

### 编译时间参考

| 操作 | 首次编译 | 增量编译 | 说明 |
|------|---------|---------|------|
| `npm run tauri dev` | 2-5 分钟 | 10-30 秒 | 开发模式 |
| `npm run tauri build` | 5-10 分钟 | 2-5 分钟 | 生产构建 |
| `npm run dev` | 5-10 秒 | 1-2 秒 | 仅前端 |
| `npm run build` | 10-20 秒 | 5-10 秒 | 仅前端 |

### 常见问题

**Q: 编译太慢怎么办？**
A: 参考下面的"编译优化指南"，使用 sccache 可以提速 50-80%。

**Q: 修改前端代码后需要重新编译吗？**
A: 不需要，`npm run tauri dev` 支持热重载，保存即生效。

**Q: 修改 Rust 代码后需要重新编译吗？**
A: 需要，但 `npm run tauri dev` 会自动检测并重新编译。

**Q: 如何只编译前端不启动 Tauri？**
A: 使用 `npm run dev`，然后在浏览器中访问。

**Q: 生成的可执行文件在哪里？**
A: Windows 在 `src-tauri/target/release/clipbox.exe`。

### 测试

目前尚未实现测试套件。添加测试时请遵循：

* 后端测试：`cargo test --manifest-path src-tauri/Cargo.toml`
* 前端测试：添加测试框架（如 Vitest）并使用 `npm test`

## 编译优化指南

### 当前配置状态

项目已配置基础优化（位于 `src-tauri/.cargo/config.toml`）：
- ✅ 增量编译已启用
- ✅ LLD 链接器已配置
- ✅ 并行编译设置为 8 核

### 进一步优化方案

#### 1. 开发模式优化（推荐）

修改 `src-tauri/.cargo/config.toml` 的 `[profile.dev]` 部分：

```toml
[profile.dev]
opt-level = 1          # 轻度优化依赖库，加快运行速度
incremental = true
split-debuginfo = "unpacked"  # Windows 上加快链接
```

**效果：** 首次编译稍慢，但后续增量编译更快，运行速度提升明显。

#### 2. 依赖优化

在 `src-tauri/Cargo.toml` 中精简依赖特性：

```toml
# 示例：只启用需要的 image 格式
image = { version = "0.25", default-features = false, features = ["png", "jpeg"] }

# 示例：reqwest 只用 rustls，不用 native-tls
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
```

**已应用：** 项目已正确配置 `default-features = false`。

#### 3. 使用 Mold 链接器（Linux）或保持 LLD（Windows）

**Windows（当前配置）：**
```toml
[target.x86_64-pc-windows-msvc]
rustflags = ["-C", "link-arg=-fuse-ld=lld"]
```

**Linux 可选：**
```bash
# 安装 mold（比 lld 更快）
sudo apt install mold  # Ubuntu/Debian
# 或
cargo install mold

# 配置使用
[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=mold"]
```

#### 4. 使用 sccache 缓存编译结果

```bash
# 安装 sccache
cargo install sccache

# 配置环境变量（添加到 ~/.bashrc 或系统环境变量）
export RUSTC_WRAPPER=sccache

# Windows PowerShell
$env:RUSTC_WRAPPER="sccache"

# 验证
sccache --show-stats
```

**效果：** 跨项目共享编译缓存，清理后重新编译速度提升 50-80%。

#### 5. 调整并行编译数

根据 CPU 核心数调整 `src-tauri/.cargo/config.toml`：

```toml
[build]
jobs = 12  # 设置为 CPU 核心数或稍少
```

**当前设置：** `jobs = 8`，如果你的 CPU 有更多核心可以提高。

#### 6. 开发时只编译后端

```bash
# 不启动前端，只编译运行 Rust
cd src-tauri
cargo run

# 或使用 cargo-watch 实现热重载
cargo install cargo-watch
cargo watch -x run
```

#### 7. 减少 Release 构建时间

修改 `src-tauri/.cargo/config.toml` 的 `[profile.release]`：

```toml
[profile.release]
opt-level = "z"        # 优化体积而非速度，编译更快
lto = "thin"           # 保持 thin LTO（已配置）
codegen-units = 16     # 增加并行度（已配置）
strip = true           # 自动剥离符号
```

#### 8. 使用 Cargo 工作区（可选，适合多 crate 项目）

如果未来拆分更多模块，可以创建 workspace：

```toml
# 根目录 Cargo.toml
[workspace]
members = ["src-tauri", "clipbox-core", "clipbox-platform"]
resolver = "2"

[workspace.dependencies]
tokio = { version = "1", features = ["rt-multi-thread"] }
```

### 编译速度对比

| 优化方案 | 首次编译 | 增量编译 | 难度 |
|---------|---------|---------|------|
| 基础配置（当前） | 基准 | 基准 | ✅ 已完成 |
| opt-level = 1 | +10% | -30% | 简单 |
| sccache | 持平 | -50% | 简单 |
| mold 链接器 | -20% | -15% | 中等 |
| 依赖精简 | -15% | -10% | 中等 |

### 推荐操作步骤

1. **立即可做：** 安装并启用 sccache（最大收益）
2. **修改配置：** 设置 `opt-level = 1` 在 dev profile
3. **长期优化：** 定期审查依赖，移除不需要的 features

### 验证编译时间

```bash
# 清理后测试完整编译
cargo clean --manifest-path src-tauri/Cargo.toml
time cargo build --manifest-path src-tauri/Cargo.toml

# 测试增量编译（修改一个文件后）
time cargo build --manifest-path src-tauri/Cargo.toml
```

## 架构

### 高层结构

```
前端 (React)
    ↕ Tauri IPC (JSON-RPC)
Rust 核心层 (平台无关)
    ↕
平台抽象层
    ↕
操作系统 API (Windows/macOS/Linux)

```

### 后端模块组织

Rust 后端采用分层架构：

**`src-tauri/src/`**

* **`core/`**：业务逻辑层
* `clipboard_manager.rs`：主剪贴板调度、监控、去重。
* `models.rs`：数据结构（剪贴板条目、内容等）。


* **`platform/`**：操作系统特定实现
* `clipboard_trait.rs`：平台抽象特征（Trait）。
* `windows.rs`：Windows 剪贴板 API 实现。
* 未来规划：`linux.rs`，`macos.rs`。


* **`repository/`**：数据访问层
* `clipboard_repo.rs`：通过 SQLx 进行 SQLite 操作。


* **`commands/`**：Tauri 命令句柄（IPC 端点）
* `clipboard_commands.rs`：条目的增删改查。
* `ai_commands.rs`：AI 标签配置与生成。
* `drag_drop_commands.rs`：拖拽功能支持。


* **`ai/`**：AI 集成
* `mod.rs`：支持多供应商（硅基流动、火山引擎、阿里巴巴、自定义）的 AI 服务。



### 关键设计模式

**平台抽象：**
通过 `PlatformClipboard` 特征定义获取和设置内容的标准接口。每个操作系统实现该特征，使核心逻辑保持平台无关。
务必保证可扩展性


**异步流水线：**
所有重型操作（图像处理、OCR、AI）均通过 Tokio 异步运行，避免阻塞主线程。模式为：

1. 捕获 → 存入数据库（快速、同步）。
2. 返回 UI（乐观更新）。
3. 后台处理（缩略图、AI 标签）。
4. 将结果更新至数据库。

**仓库模式：**
数据库访问集中在 `ClipboardRepository`，利用 SQLx 进行编译时 SQL 校验和异步查询。

### 数据库表结构

SQLite 数据库位于应用数据目录下的 `clipbox.db`：

* **clipboard_items 表**：存储条目 ID、类型（文本/图片/文件）、内容或路径、缩略图 JSON、标签 JSON、用户笔记、元数据以及时间戳。

**重要提示：** 图片存储在文件系统中，数据库仅以 JSON 格式存储路径。

### 前端结构

**`src/`**

* `App.jsx`：主组件，包含历史列表、搜索、编辑功能。
* `Settings.jsx`：AI 配置弹窗，支持多语言切换。
* `DragDrop.jsx`：拖拽功能组件。
* `App.css` / `Settings.css` / `DragDrop.css`：样式表。
* `i18n/`：国际化配置和语言文件
  * `index.js`：i18next 配置
  * `locales/zh-CN.json`：简体中文翻译
  * `locales/en-US.json`：英文翻译

**关键前端模式：**

* 通过 `setInterval` 每 3 秒自动刷新。
* 行内笔记编辑（点击即编辑，无需弹窗）。
* 带加载状态的 AI 标签生成。
* 支持跨内容、标签、笔记和来源应用的全局搜索。
* 全局拖拽监听，支持拖入文本、图片、文件。
* 每个卡片可拖出到其他应用。
* 国际化支持：使用 react-i18next，语言选择持久化到 localStorage。

## 关键实现细节

### Windows 剪贴板监控

由于 Tauri 线程限制，采用每 500ms 轮询一次的方式，通过哈希比较检测剪贴板变化。

### 图像处理

1. 原图保存至 `images/original/`。
2. 生成最大 300x300 的缩略图至 `images/thumbnails/`。
3. 前端使用 Tauri 的 `convertFileSrc()` 访问本地文件。

### 文件复制检测

Windows 文件复制使用 `CF_HDROP` 格式。程序提取文件路径并将其作为换行符分隔的字符串存储在内容字段中。

### AI 集成

* 支持 OpenAI 兼容格式。
* AI 生成的标签带有 `AI:` 前缀以示区别。

### 拖拽功能

**拖入（Drop In）：**
* 全局监听拖拽事件（dragenter、dragleave、dragover、drop）。
* 支持文本、图片（base64）、文件路径三种类型。
* 拖入时显示半透明遮罩层和提示动画。
* 使用计数器避免嵌套元素导致的闪烁。

**拖出（Drag Out）：**
* 每个 item-card 设置 `draggable="true"`。
* 通过 `dataTransfer.setData()` 传递内容。
* 文本项传递文本内容，图片项传递图片路径，文件项传递文件路径。
* 拖拽时卡片变为半透明，鼠标变为抓取状态。

**后端支持：**
* `add_clipboard_item_manual` 命令处理手动添加的内容。
* 自动生成缩略图、计算哈希、保存元数据。
* 来源应用标记为"拖拽"。

## 常见坑点

1. **时间显示：** 数据库存储秒级时间戳，JS `Date()` 需要毫秒，务必乘以 1000。
2. **数据库连接：** 使用 `sqlite://{path}?mode=rwc` 格式。
3. **资源协议：** 必须在 `tauri.conf.json` 中配置资源访问权限范围。
4. **异步上下文：** 不要错误地混用阻塞代码和异步代码。

## 未来扩展

架构预留了 OCR 文本字段、向量搜索（Embedding）和插件系统接口，并支持本地优先的云同步设计。


### 编码设计
优先模块化设计 便于后续重构

## 可扩展性
对于数据库设计和整体业务逻辑 需要保证高度可扩展性

## 对话中文
要求整个对话是中文

## 国际化支持

项目已集成 i18next 和 react-i18next 实现国际化。

**当前支持的语言：**
* 简体中文 (zh-CN) - 默认语言
* English (en-US)

**使用方式：**
* 设置页面切换：设置 → 通用设置 → 语言
* 语言选择自动保存到 localStorage

**开发指南：**
* 在组件中使用 `const { t } = useTranslation()` 获取翻译函数
* 使用 `t('key.path')` 获取翻译文本
* 带参数的翻译：`t('error.message', { error: errorMsg })`
* 翻译文件位于 `src/i18n/locales/`
* 详细文档见 `docs/i18n-guide.md`

## MCP 集成

ClipBox 集成了 MCP (Model Context Protocol) 服务器，允许 AI 助手（如 Claude Desktop）直接访问剪贴板数据。

**架构：**
```
Claude Desktop
    ↕ stdio (JSON-RPC)
ClipBox MCP Server
    ↕ 内部 API
ClipBox Core
```

**模块结构：**
* `src-tauri/src/mcp/` - MCP 模块
  * `config.rs` - MCP 配置（默认启用）
  * `protocol.rs` - JSON-RPC 2.0 协议定义
  * `server.rs` - MCP 服务器实现（stdio 模式）
  * `tools.rs` - 工具集实现

**可用工具：**
1. `clipbox_search` - 搜索剪贴板历史
2. `clipbox_recent` - 获取最近记录
3. `clipbox_get` - 获取指定条目
4. `clipbox_add` - 添加新条目（仅文本）
5. `clipbox_delete` - 删除条目
6. `clipbox_stats` - 获取统计信息

**设置：**
* 设置 → MCP 服务 → 启用/禁用
* 默认开启，可在设置中关闭
* 详细配置见 `docs/mcp-guide.md`

## 代码规范
1. 尽可能模块化文件 方法 和函数
2. 一个文件不准超过800行
3. 尽量抽象出来
4. 尽可能考虑多平台的影响 比如windows mac和linux