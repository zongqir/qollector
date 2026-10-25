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

# 代码静态语法与未声明变量检查（oxlint，超极速，必须 0 报错）
npm run lint:code

# 全量门禁校验（代码语法 + 样式严格守卫）
npm run lint

# 前端构建（自动前置执行 lint:code 门禁）
npm run build

# Tauri 生产构建
npm run tauri build
```

## Collector 服务端 / Docker 部署（必读）

当任务包含 `Collector`、剪贴板上传、服务器部署、Docker、Docker Compose、HTTPS、Caddy、日志归档或服务端 AI 分析时，**必须先完整阅读 [`collector/README.md`](collector/README.md)**，再修改配置、编排文件或给出部署命令。Collector 是独立的 Go 服务，不属于 Tauri 客户端构建或发版流程。

按部署场景继续阅读对应文件：

1. 服务器已有 Caddy/Nginx 等 HTTPS 反向代理：阅读 [`collector/docker-compose.yml`](collector/docker-compose.yml) 和 [`collector/.env.example`](collector/.env.example)。该模式只绑定 `127.0.0.1`，由现有反向代理对外提供 HTTPS。
2. 服务器没有现成反向代理：阅读 [`collector/docker-compose.standalone.yml`](collector/docker-compose.standalone.yml)、[`collector/Caddyfile`](collector/Caddyfile) 和 [`collector/.env.example`](collector/.env.example)。该模式自带 Caddy 并占用 `80/443`。
3. 变更 Collector 的接收、鉴权、文本截断、归档或保留行为：额外阅读 [`collector/main.go`](collector/main.go) 和 [`collector/main_test.go`](collector/main_test.go)。
4. 发布 Collector 镜像：阅读 [`.github/workflows/collector-image.yml`](.github/workflows/collector-image.yml)；该流程由 `collector-v*` 标签触发，和桌面客户端 Release 分开。

部署约束：两种 Compose 模式只能二选一；不要在已有 Caddy 的服务器再启动 standalone 模式；生产环境不要将 Collector 的纯 HTTP 端口直接暴露到公网；`QOLLECT_TOKEN` 必须在服务器的 `.env` 中设置为长随机值。

## 发版紧急清单（URGENT）

当用户提到“发版 / 版本升级 / 发布更新 / 出包 / 包”时，代理必须按 `docs/release-ai-runbook.md` 执行完整流程，不得跳步。

### 触发口令（推荐）

1. `按 docs/release-ai-runbook.md 发版到 0.2.5`
2. `我要发版到 0.2.5，帮我补齐中英文更新说明并发布`
3. `开始版本升级，目标 0.2.5，按 runbook 全流程执行`
4. **极简口令**：只要用户说“**包**”或“**出包**”，自动将 patch 小版本号 +1，提炼当前改动补齐中英文 `release-notes.json`，执行 `npm run build` 校验后通过 Git 提交并推送到 GitHub 触发 Release workflow 全流程。

### 必改文件（最少）

1. `package.json`（version）
2. `src-tauri/tauri.conf.json`（version）
3. `src/data/release-notes.json`（新增当前版本中英文摘要与要点）

### 必跑命令（按顺序）

```powershell
# 1) 全量门禁校验与构建（强制阻断未声明变量与样式违规）
npm run lint
npm run build

# 2) 提交并推送版本变更，由 GitHub Release workflow 正式发布
# workflow: .github/workflows/release.yml
```

### 发布后必验收

1. `https://github.com/zongqir/qollect/releases/tag/v<version>` 可访问。
2. `https://dl.zongqir.com/latest.json` 版本号正确。
3. `https://dl.zongqir.com/release-notes.json` 包含当前版本条目。

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

## UI 可借鉴优点（ElegantClipboard，新增）

当需求涉及主窗口、历史流、收藏区、工作区、设置页的 UI 优化时，默认优先参考以下可复用实践：

1. 统一视觉语法优先于局部美化：先统一 `color/background/card/border/muted/primary/radius/shadow` 设计令牌，再改具体组件，避免“每个模块一个风格”。
2. 强调色克制使用：强调色仅用于“选中态 / 主操作 / 关键状态”，常态内容尽量使用中性灰阶，保证信息密集场景下可读性。
3. 层级要稳定：卡片、面板、弹层统一采用“背景 + 细边框 + 轻阴影”三段层级，不随页面随意变化明暗强度。
4. 主列表默认简洁：次要操作（复制/删除/更多）优先使用 hover/右键显隐，不在常态占满视觉注意力。
5. 状态反馈必须即时且可见：选中、批量、置顶、收藏、失效、搜索高亮等状态都要有明确视觉反馈，且同语义状态在不同视图表现一致。
6. 动效节奏短而统一：入场、切换、hover、拖拽反馈统一控制在短时长区间（约 `120~220ms`），优先 `ease-out`，避免拖沓动画影响效率感。
7. 滚动体验优先：长列表必须优先保证流畅度（虚拟列表、占位骨架、滚动条可见性策略），不允许为装饰效果牺牲滚动性能。
8. 信息密度可配置：卡片行数、密度、元信息展示项（时间/字符数/来源）应支持配置，满足不同用户“速览 vs 细看”偏好。
9. 主题能力要完整：浅色/深色/系统色与窗口材质（如毛玻璃）应统一接入同一主题系统，避免组件各自维护主题状态。
10. 审美改动必须兼顾 mini 与正常模式：任何列表/卡片/工具栏/弹层改动都要同时验证 `320x450` mini 与常规窗口，不允许只在单尺寸下“好看”。

### 本仓库落地要求（UI）

1. 提交 UI 改动时，说明中需包含：影响区域（历史流/收藏区/工作区/设置）、状态覆盖、mini 与正常模式验证结果。
2. 若改动涉及筛选/排序/视图切换，必须同时检查“视觉一致性 + 语义一致性 + 后端筛选链路一致性”。
3. Code Review 若发现“只做视觉改色但未处理交互态/空态/加载态/错误态”，视为必须补齐项。

## 卡片交互防回归约定（新增）

当需求涉及“历史流 / 收藏区 / 工作区”的卡片点击、双击、调色板、拖拽、预览等交互时，默认遵循：

1. 卡片内操作按钮、颜色面板、颜色点、更多菜单等子交互，必须同时防住 `pointerdown / mousedown / click / dragstart`，不能只拦 `click`。
2. 若卡片外层接了 `dnd-kit`、长按进排序、单击预览延时器、双击复制等父级手势，父层点击入口也必须对白名单子元素做忽略，不能只依赖子组件 `stopPropagation`。
3. `shouldIgnoreCardDoubleClickTarget` 一类公共忽略规则，禁止把当前卡片根节点本身误判为“应忽略交互目标”；若卡片根节点带 `role="button"`，需结合 `currentTarget` 排除自身命中。
4. 使用 `panel-card-actions--hover-reveal` 一类默认 `pointer-events: none` 的公共壳层时，新增弹层（如颜色面板）必须显式恢复命中能力，避免“看得到但点不到，点击穿透到底层卡片”。
5. 工作区、收藏区、历史流若存在语义相同的卡片动作（如调色板、双击复制、预览按钮），优先复用同一套事件防护模式；若某一处修复了交互链路，必须同步检查另外两处是否存在同类漏洞。
6. 涉及卡片交互的改动，至少手工验证以下路径：
   `单击预览`、`双击复制/自动粘贴`、`调色板打开/点色切换`、`拖拽/长按排序`、`右键菜单`、`按钮点击不误触卡片预览`。

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

## 未声明变量与代码质量防回归硬门禁（URGENT）

1. **致命陷阱警示（严禁仅以 build 成功为准）**：纯 JS/JSX 项目中，`vite build` 默认将未声明变量视为浏览器全局变量（类似 `window.xxx`）放行，即使变量不存在也能打包成功！必须严禁用“build 成功”作为变量没有未定义的依据！
2. **重构符号归零铁律**：凡是删除/重命名 `import`、`const`、`let`、状态、函数或作用域变量，**必须对原变量名进行全文件全局检索**，确保所有引用、JSX 属性、条件判断、`useCallback` 依赖数组中的残留引用彻底清零！
3. **强制门禁执行**：提交前与发版前必须执行 `npm run lint:code`（基于 `oxlint` 毫秒级断言 `no-undef` 规则），若有哪怕一个未声明变量，门禁将直接中断失败，不通过不允许提交与发包。

## 提交前自检建议

1. 受影响功能手工验证一遍（至少主路径）。
2. 检查当前修改文件是否过大
3. 是否考虑多平台 其他平台是否兼容或者TODO标注 是否面相接口
4. 检查 i18n 文案是否补齐中英文键值。
5. 确认未引入不必要的格式化噪音与无关文件变动。

嗯嗯 我是这么想的 如果很关注内存 那我就不要这部分的用户.....我要筛选用户.


每次修改界面逻辑 需要分析在mini模式 正常模式下 的历史流区 收藏区 和工作区 综合的考虑 而非单一考虑问题
