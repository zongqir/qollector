# CLAUDE.md

此文件为 Claude Code 在处理本仓库代码时提供指导。

## 项目概述

ClipBox 是一款现代化的跨平台剪贴板管理器，使用 Rust (Tauri v2) 和 React 构建。

**核心理念：**
1. 极致简洁：零配置，默认即最优
2. 审美优先：现代 UI，深色模式，毛玻璃效果，流畅动画
3. 真正跨平台：Linux 优先原则，统一的 Windows/macOS/Linux 体验
4. 国际化支持：多语言切换（简体中文、English），易于扩展
5. AI 集成：支持 MCP (Model Context Protocol)

---

## ⚠️ 核心规则

### 1. 禁止自动编译

**严格禁止 Claude 执行任何编译命令！**

- ❌ 禁止运行 `cargo build`、`cargo check`、`npm run tauri build`
- ❌ 禁止运行 `npm run tauri dev` 进行测试
- ✅ 完成代码修改后，只需提示用户运行 `npm run tauri dev`
- ✅ 用户会自己决定何时编译和测试

### UTF-8写代码
涉及到中文 用UTF-8
注释和print echo等调试不允许写中文

**原因：** 编译耗时长（2-10 分钟），浪费用户时间。

### 2. 对话语言

**要求整个对话使用中文。**

### 3. 国际化优先

**所有用户可见的文本必须支持国际化：**
- 使用 `t('key.path')` 而非硬编码文本
- 新增文本需同时更新 `src/i18n/locales/zh-CN.json` 和 `en-US.json`
- 翻译文件位于 `src/i18n/locales/`

**示例：**
```javascript
// ❌ 错误
<button>保存</button>

// ✅ 正确
const { t } = useTranslation();
<button>{t('common.save')}</button>
```

### 4. 模块化设计

**强制要求：**
- 单个文件不超过 500 行
- 优先模块化拆分（文件、方法、函数）
- 服务层必须高度模块化，便于扩展和重构
- 考虑跨平台影响（Windows/macOS/Linux）

### 5. 可扩展性

**数据库设计和业务逻辑必须保证高度可扩展性：**
- 使用平台抽象层（Trait）隔离操作系统差异
- 配置支持多供应商（AI/OCR），独立存储凭证
- 预留扩展接口（OCR、向量搜索、插件系统）

---

## 快速开始

### 开发模式
```bash
npm run tauri dev  # 启动前端+后端，支持热重载
```

### 生产构建
```bash
npm run tauri build  # 生成可执行文件
```

### 仅前端开发
```bash
npm run dev  # 浏览器访问 http://localhost:5173
```

---

## 架构概览

### 分层结构
```
前端 (React + i18next)
    ↕ Tauri IPC
Rust 核心层
    ↕ 平台抽象层 (Trait)
    ↕ 操作系统 API
```

### 后端模块
- **`core/`** - 业务逻辑（clipboard_manager, models）
- **`platform/`** - 平台抽象（clipboard_trait, windows/linux/macos）
- **`repository/`** - 数据访问（clipboard_repo, config_repo）
- **`commands/`** - Tauri 命令（clipboard/ai/ocr/mcp_commands）
- **`ai/`** - AI 服务（多供应商支持）
- **`ocr/`** - OCR 服务（多供应商支持）
- **`mcp/`** - MCP 服务器（端口管理、优雅关闭）

### 前端模块
- **`App.jsx`** - 主界面（历史列表、搜索、编辑）
- **`Settings.jsx`** - 设置面板（AI/OCR/MCP 配置）
- **`i18n/`** - 国际化配置和翻译文件

### 数据库
- **clipboard_items** - 剪贴板条目（文本/图片/文件）
- **app_config** - 应用配置（AI/OCR/MCP，JSON 格式持久化）

**重要：** 多供应商配置独立存储，切换时自动加载对应凭证。

---

## 国际化支持

**当前支持：**
- 简体中文 (zh-CN) - 默认
- English (en-US)

**开发指南：**
```javascript
// 1. 导入翻译函数
import { useTranslation } from 'react-i18next';
const { t } = useTranslation();

// 2. 使用翻译
t('settings.ai.title')  // 基础用法
t('error.message', { error: errorMsg })  // 带参数

// 3. 添加新翻译
// 在 src/i18n/locales/zh-CN.json 和 en-US.json 中添加对应键值
```

---

## MCP 集成

**功能：** 允许 AI 助手（如 Claude Desktop）直接访问剪贴板数据

**模块：** `src-tauri/src/mcp/`
- `config.rs` - 配置管理
- `server.rs` - HTTP 服务器（支持优雅关闭）
- `port_manager.rs` - 智能端口管理（检测并清理僵尸进程）
- `lock_file.rs` - 进程锁文件（防止端口泄漏）
- `tools.rs` - 工具集（搜索、获取、添加、删除）

**特性：**
- 单例模式（防止多实例冲突）
- 智能端口管理（自动清理僵尸进程）
- 优雅关闭（多层保障释放端口）
- 详见 `docs/single-instance-port-management.md`

---

## 代码规范

1. **模块化** - 单文件不超过 800 行，优先拆分
2. **抽象化** - 使用 Trait 隔离平台差异
3. **跨平台** - 考虑 Windows/macOS/Linux 兼容性
4. **国际化** - 所有文本使用 `t()` 函数
5. **异步优先** - 重型操作（图像、OCR、AI）使用 Tokio 异步
6. **配置持久化** - 所有配置自动保存到数据库

---

## 剪贴板内容过滤规则

### 空白内容处理
**规则：** 短空白跳过，长空白保留

**逻辑：**
- 如果文本 `trim()` 后为空（全是空白字符）
- 统计换行符数量：
  - **< 3 行**：跳过（认为是无意义的短空白或空字符串）
  - **≥ 3 行**：保留（可能是有意义的大片空白，用户可能需要）

**实现位置：** `src-tauri/src/core/clipboard_manager.rs:96-112`

**设计理念：**
- 避免浪费存储空间保存无意义的空白
- 尊重用户可能需要复制大片空白的场景（如代码格式化、文档排版）

---

## UI 显示规则

### AI 标签按钮
**显示条件（同时满足）：**
- **AI 功能已启用**（`aiEnabled === true`）
- 条目类型为文本
- 有内容
- **未包含 AI 标签**（标签不以 `AI:` 开头）

**设计理念：**
- 只有在 AI 功能启用时才显示按钮
- 避免用户点击后因功能未启用而产生困惑
- 已有 AI 标签的条目不再显示按钮，避免重复生成

### OCR 按钮
**显示条件（同时满足）：**
- **OCR 功能已启用**（`ocrEnabled === true`）
- 条目类型为图片
- **未识别过 OCR**（`ocr_text` 为空）

**设计理念：**
- 只有在 OCR 功能启用时才显示按钮
- 避免用户点击后因功能未启用而产生困惑
- 已识别出文字的图片不再显示按钮，避免重复识别

**核心原则：** 按钮的显示取决于**功能是否启用**和**是否已有结果**两个条件。功能未启用时不显示按钮，避免用户困惑。

---

## 常见问题

**Q: 修改前端代码后需要重新编译吗？**
A: 不需要，`npm run tauri dev` 支持热重载。

**Q: 修改 Rust 代码后需要重新编译吗？**
A: 需要，但 `npm run tauri dev` 会自动检测并重新编译。

**Q: 如何添加新的翻译？**
A: 在 `src/i18n/locales/zh-CN.json` 和 `en-US.json` 中添加对应键值。

**Q: 如何测试 MCP 服务器？**
A: 启动应用后访问 `http://localhost:38470/health` 检查健康状态。
