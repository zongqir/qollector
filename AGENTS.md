# Repository Guidelines

## 项目结构与模块组织
本仓库是 Tauri v2 + React 的跨平台桌面应用。

- 前端位于 `src/`：组件、hooks、services、store 与 `src/styles/`。
- 后端位于 `src-tauri/src/`：`commands/`、`core/`、`repository/`、`platform/`、`mcp/`、`share/` 等模块。
- 静态资源在 `public/`，前端构建输出到 `dist/`。
- 设计与实现文档在 `docs/`、`SSD/`。
- 根目录 `test_*.py`、`test_*.sh`、`test_*.html` 为联调/手动验证脚本。

## 构建、测试与开发命令
以下命令供开发者手动执行；Agent 默认不自动触发编译与打包。

- `npm run dev`：启动前端开发服务器。
- `npm run build`：构建前端资源到 `dist/`。
- `npm run preview`：预览构建结果。
- `npm run tauri -- dev`：启动桌面应用开发模式。
- `npm run tauri -- build`：构建桌面安装包。
- `cargo check --manifest-path src-tauri/Cargo.toml`：检查 Rust 编译。
- `cargo test --manifest-path src-tauri/Cargo.toml`：运行 Rust 测试。

## 代码风格与模块化规范
- JavaScript/JSX 使用 2 空格缩进、分号、单引号（参考 `src/App.jsx`）。
- 组件使用 `PascalCase`，Hook 使用 `useXxx`，工具/服务使用 `camelCase`。
- Rust 使用 `rustfmt` 默认风格，文件与模块采用 snake_case。
- 强制模块化设计：优先拆分职责，避免“上帝文件”。
- 单文件上限 500 行；接近 400 行时应提前拆分。
- 新增注释、日志、`print/echo` 调试文本统一使用英文，避免编码与检索问题。

## 跨平台抽象要求
- 所有平台差异代码放在 `src-tauri/src/platform/`，通过 Trait/接口隔离。
- 业务层（`core/`、`commands/`）禁止直接耦合 Windows/macOS/Linux 特有 API。
- 路径、快捷键、拖拽、剪贴板等能力必须先设计抽象，再落地平台实现。
- 新功能默认按多平台可扩展设计，避免只针对单系统临时硬编码。

## 国际化要求
- 所有用户可见文本必须国际化，前端使用 `t('key.path')`，禁止硬编码文案。
- 新增文案时必须同步更新 `src/i18n/locales/zh-CN.json` 与 `src/i18n/locales/en-US.json`。
- 翻译 key 使用按模块分组命名，如 `settings.ai.title`、`error.copy.failed`。

## 代理执行约束（补充）
- 文件与输出统一 UTF-8 编码。
- 终端优先使用 Git Bash；若当前环境不可用，需说明原因后回退到 UTF-8 兼容方案。
- 对话语言统一中文。
- 默认不自动执行耗时编译命令（如 `cargo build`、`cargo check`、`npm run tauri dev/build`）；由用户手动触发。

## 测试指南
- 优先在 `src-tauri/src/tests/` 与 `#[cfg(test)]` 中补充 Rust 单元/集成测试。
- OCR、MCP 等联调可复用根目录脚本（如 `test_ocr_api.py`、`test_mcp.sh`）。
- 测试命名应体现行为，例如 `clipboard_repo_persists_tags`。

## 提交与合并请求规范
- 仓库历史包含 `feat:`/`fix:`/`refactor:` 及 `[ADD]`/`[FIX]` 两类风格。
- 新提交建议使用 Conventional Commits：`feat(scope): summary`、`fix(scope): summary`。
- 每次提交保持原子性，避免混入无关改动。
- PR 需包含变更说明、关联任务、测试证据和必要的 UI 截图/GIF。

## 安全与配置提示
- 禁止提交真实 API Key、Token、数据库产物或其他敏感信息。
- 修改 `src-tauri/tauri.conf.json` 的权限与 capability 时必须做最小权限复核。

