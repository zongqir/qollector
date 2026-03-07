# AGENTS.md

此文件为通用代码代理（Codex / Claude Code / 其他 CLI 代理）在本仓库工作时提供统一指导。

## 项目定位

Qollect 是一个基于 Tauri（Rust + React）的现代剪贴板管理器，重点在于：

1. 零配置可用，默认体验优先。
2. 高质量 UI（深色主题、毛玻璃、流畅交互）。
3. 跨平台一致性（Windows / macOS / Linux）。
4. 国际化（当前至少 `zh-CN`、`en-US`）。
5. AI 能力集成（含 MCP 相关能力）。

## 常用命令

```bash
# 前后端联调（推荐）
npm run tauri dev

# 前端开发
npm run dev

# 前端构建
npm run build

# Tauri 生产构建
npm run tauri build
```

## 发版紧急清单（URGENT）

当用户提到“发版 / 版本升级 / 发布更新”时，代理必须按 `docs/release-ai-runbook.md` 执行完整流程，不得跳步。

### 触发口令（推荐）

1. `按 docs/release-ai-runbook.md 发版到 0.2.5`
2. `我要发版到 0.2.5，帮我补齐中英文更新说明并发布`
3. `开始版本升级，目标 0.2.5，按 runbook 全流程执行`

### 必改文件（最少）

1. `package.json`（version）
2. `src-tauri/tauri.conf.json`（version）
3. `src/data/release-notes.json`（新增当前版本中英文摘要与要点）

### 必跑命令（按顺序）

```powershell
# 1) 构建校验
npm run build

# 2) 正式发布（生成 latest.json / GitHub Release / R2 上传）
.\release.ps1
```

### 发布后必验收

1. `https://github.com/zongqir/qollect/releases/tag/v<version>` 可访问。
2. `https://dl.135070.xyz/latest.json` 版本号正确。
3. `https://dl.135070.xyz/release-notes.json` 包含当前版本条目。

### 执行约束

1. 不允许在多个地方重复手写更新说明，统一以 `src/data/release-notes.json` 为单一数据源。
2. 若信息不全（缺中英文摘要/要点），先补问再执行。
3. 若 `npm run build` 失败，先修复再发布。
4. 完成后需回报：版本号、修改文件、构建结果、发布结果、验收链接。

## 筛选策略紧急约束（URGENT）

当需求涉及“历史流 / 收藏区 / 工作区”的检索与筛选时，默认遵循以下约束：

1. 默认策略是“后端筛选优先”，前端仅负责展示状态与必要排序，不承担主筛选职责。
2. 若存在搜索词、类型、标签、日期、置顶、收藏等任一筛选条件，应优先通过 `search_items` + `SearchFilters` 下推到后端执行。
3. 前端允许保留轻量显示级过滤（如下拉候选项检索、局部 UI 标签显示），但不得替代数据主筛选链路。
4. 新增筛选项时，需同步评估 `SearchFilters` 字段与仓储 SQL 分支（FTS / LIKE / fallback）是否一致生效。
5. Code Review 若发现“主列表筛选在前端执行而后端未参与”，视为必须修复项。

## 代码结构（简版）

- `src/`: React 前端
- `src-tauri/src/core/`: 业务核心
- `src-tauri/src/platform/`: 平台抽象与实现
- `src-tauri/src/repository/`: 数据访问层（SQLx + SQLite）
- `src-tauri/src/commands/`: Tauri IPC 命令入口
- `src/i18n/locales/`: 多语言资源

## 开发约定

1. 对话与说明优先使用中文。
2. 变更尽量小步，避免无关重构。
3. 所有用户可见文案必须走 i18n，不硬编码。
4. 涉及搜索/筛选/多选等状态联动时，优先保证一致性与可回归验证。
5. 涉及数据库结构或核心流程的调整，优先保证可扩展性。
6. 默认不提交临时文件、AI 工具配置、调试产物（由 `.gitignore` 管理）。

## 弹层响应式约定（新增）

当改动 `Settings / EditModal / ShareModal / 其他 overlay modal` 时，默认按以下规则做窄窗与 mini 模式兼容：

1. 断点优先考虑 `max-width: 560px`（必要时补 `420px`）。
2. Overlay 在小窗下使用 `padding` 并允许内容撑满可视区（避免被裁剪）。
3. Modal 在小窗下优先 `width: 100%`、`max-height: 100%`，内容区可滚动。
4. 双栏布局（如侧边 Tab + 内容）在小窗下必须降级为单栏或横向可滚动标签栏。
5. Footer 操作区在小窗下优先“按钮可点不挤压”：允许换行/纵向排列，按钮 `width: 100%` 或等分栅格。
6. 避免在小窗保留大 `min-width` 输入控件；必要时改为 `min-width: 0` + `width: 100%`。
7. 中英文都要验证，尤其是中文长文案按钮（如“保存备注和标签”）不能出现逐字竖排挤压。
8. 至少手工验证尺寸：`320x450`（mini）、`375x667`、`560x700`、`800x600`。

## 历史焦虑缓解约定（新增）

当需求涉及“用户因历史流堆积产生焦虑/强迫清理”时，默认按以下产品方向处理：

1. 在 `设置 > 通用` 提供“启动默认视图”配置：`历史流 / 收藏`。
2. 当用户选择“启动默认收藏视图”时，提供“安心预设”入口（快捷应用保留策略）。
3. 安心预设当前统一为：`自动清理开启 + 最多保留 7 天 + 最多保留 1000 条`。
4. 保留策略当前仅使用“天数 + 条数”模型，不引入小时级兼容。
5. 在历史流底部持续展示当前自动清理状态，并提供一键跳转到数据设置进行调整。
6. 在参数未明确时，优先采用可回滚默认值并先落地，不反复确认微小参数。

## 收藏区解耦约定（新增）

当需求涉及“收藏区（Favorites）与历史流/工作区（Workbench）解耦”时，默认遵循：

1. 收藏区主数据源使用 `is_favorite`，工作区语义使用 `is_pinned`，两者不得混用。
2. 收藏区筛选状态必须独立（如 `collectionSearchQuery / collectionSelectedTags / collectionSelectedDateRange`），不能复用历史流筛选状态。
3. 收藏区保存视图（Saved Views）使用独立存储 key，避免与历史流互相污染。
4. 收藏区内“移出列表/清空/快照恢复/去重”等动作，若作用对象是收藏区列表，默认按 `favorite` 语义执行。
5. 后续 UI 改造前，优先先完成语义与状态解耦，再做布局/交互重构，降低回归风险。

## 收藏流 UI 约定（新增）

当收藏视图 (`showFavoritesOnly`) 开启时，默认遵循：

1. 使用独立组件渲染收藏流（当前为 `CollectionBoard`），禁止继续复用历史流时间线行布局。
2. 收藏流展示形态为“卡片网格 + 标签横向轨道”，标签筛选逻辑使用并集（OR）。
3. 标签轨道末尾 `+` 入口用于“给当前激活卡片快速加标签”，若未激活卡片需给出明确提示。
4. 收藏流与历史流的标签筛选状态应解耦；进入收藏流时不复用历史流顶部标签筛选结果。
5. `pin` 行为仍属于 `workbench`，`favorite` 行为仍属于 `collection`，交互上可并存但语义不可交叉。

## 命名语义硬约束（新增）

为避免语义漂移与后续维护混乱，涉及 `pin/favorite` 的命名必须遵循以下硬约束：

1. `pin` 语义只允许对应 `workbench`：`is_pinned <-> workbench`。
2. `favorite` 语义只允许对应 `collection`：`is_favorite <-> collection`。
3. 所有工作区相关命名（组件/状态/函数/CSS class/i18n key/IPC 命令）统一使用 `workbench*` 前缀或 `workbench.*` 命名空间。
4. 所有收藏区相关命名统一使用 `collection*` 前缀或 `collection.*` 命名空间，且其数据语义必须绑定 `favorite`。
5. 禁止在工作区逻辑中继续引入 `collection` 命名（兼容迁移代码除外，且需注释标明 `legacy compatibility`）。
6. 新增字段、方法、文案键前，先检查语义归属：若作用于 `pin`，命名必须落到 `workbench`；若作用于 `favorite`，命名必须落到 `collection`。
7. Code Review 若发现语义混用（例如 `is_pinned` 搭配 `collection*` 新命名），视为必须修复项，不能带入后续迭代。

## 提交前自检建议

1. 受影响功能手工验证一遍（至少主路径）。
2. 检查当前修改文件是否过大
3. 是否考虑多平台 其他平台是否兼容或者TODO标注 是否面相接口
4. 检查 i18n 文案是否补齐中英文键值。
5. 确认未引入不必要的格式化噪音与无关文件变动。

嗯嗯 我是这么想的 如果很关注内存 那我就不要这部分的用户.....我要筛选用户.


每次修改界面逻辑 需要分析在mini模式 正常模式下 的历史流区 收藏区 和工作区 综合的考虑 而非单一考虑问题
