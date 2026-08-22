# 截图复制功能移除设计

日期：2026-08-22
范围：移除“系统截图后识别并复制文本”的附加功能，保留核心 OCR 能力
状态：Approved

## 1. 背景

Qollect 当前提供的截图复制入口会唤起 Windows 系统截图，轮询新增图片，再用 OCR 识别并将结果复制到剪贴板。该路径与剪贴板管理的核心体验关联较弱，增加了设置、标题栏和后端命令的产品复杂度。

OCR 本身仍是产品能力的一部分：图片历史项可以识别文字并写回 `ocr_text`，自动 OCR、OCR 提供商配置和 AI 对图片文字的处理也依赖同一核心服务。因此本次只移除截图复制附加路径，不移除 OCR。

## 2. 目标与非目标

### 2.1 目标

1. 用户界面中不再显示“截图识别复制”设置或标题栏入口。
2. 删除仅服务于系统截图复制的前端工作流、IPC 命令和配置状态。
3. 保持图片历史项 OCR、自动 OCR、OCR 设置和 OCR 服务初始化不变。
4. 正常模式与 mini 模式下，历史流、收藏区、工作区的布局和主操作不回退。

### 2.2 非目标

1. 不移除 OCR 设置页、OCR 提供商或图片条目中的文字识别操作。
2. 不修改 OCR 结果数据模型、自动 OCR 行为或 AI 图片文字分析策略。
3. 不对历史数据库配置做迁移或清理；旧的未知配置字段在读取时自然忽略。

## 3. 方案结论

采用“完整移除截图复制路径，保留 OCR 核心”的方案：

1. 删除通用设置中的 `smart_copy_entry_enabled` 控件与前端状态映射。
2. 删除标题栏扫描按钮及其运行态、回调和专用样式。
3. 删除前端 `smartCopyService` 与 `smartCopyWorkflowService`，以及 `App` 中唤起截图、轮询和反馈逻辑。
4. 删除 Rust `smart_copy_commands` 模块及其 Tauri 命令注册，包括 `ms-screenclip:` 的系统截图唤起。
5. 删除截图复制专用的中英文文案；保留设置中的通用 OCR 文案和图片 OCR 文案。

## 4. 架构边界

### 保留

1. `ocr_commands` 中的 OCR 配置、服务初始化、可用性检查、`recognize_image` 和 `recognize_and_update`。
2. `OcrService`、`ClipboardManager` 内的自动 OCR 与图片 `ocr_text` 回写。
3. 设置中的 OCR 提供商、启用开关、测试和自动 OCR 配置。
4. 历史流、收藏区、工作区对图片 OCR 结果的展示和复制逻辑。

### 移除

1. `smart_copy_*` 命令、`start_system_screen_capture` 命令及 `commands::smart_copy_commands` 模块。
2. 截图复制前端 service、轮询工作流和标题栏按钮。
3. `GeneralConfig.smart_copy_entry_enabled` 及对应 Zustand 状态。
4. 截图复制专用 i18n 文案与 CSS 选择器。

## 5. 兼容性与风险

1. 旧配置持久化中可能仍包含 `smart_copy_entry_enabled`，Rust 默认 serde 对未知字段不报错，因此升级后可以正常读取。
2. 标题栏减少一个按钮后，右侧按钮组宽度变小；其现有 `ResizeObserver` 仍应正确更新玻璃透明度状态的右侧偏移。
3. 删除 `smart_copy_commands` 时不得触及 `ocr_commands`，否则图片历史项的 OCR 主路径会回退。

## 6. 验收标准

1. 设置页不再出现截图识别复制相关开关或说明。
2. 标题栏不再出现扫描图标，快速输入、置顶、窗口控制仍可用。
3. 图片历史项仍可手动识别文字，自动 OCR 配置仍可保存和生效。
4. 前端与 Rust 搜索中不再残留截图复制的生产代码、IPC 注册或 i18n 键。
5. `npm run build` 与 `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
6. 在 `320x450`、`375x667`、`560x700`、`800x600` 下，历史流、收藏区、工作区均无标题栏遮挡、内容跳动或操作失效。
