这份文档集成了你的**三大亮点**（简单、颜值、跨平台），明确了**产品定位**（收集工作台 vs 静态相册），并制定了**高可扩展的技术架构**（为 AI/OCR/向量预留接口）。


---

# ClipBox 产品需求文档 (Master PRD v1.0)

## 1. 项目概览 (Project Overview)

* **产品名称**: **ClipBox**
* **核心定位**: 一个现代化、跨平台、高颜值的剪切板收集与流转工作台。
* **一句话愿景**: "The most aesthetic and frictionless clipboard hub for developers and creators on Windows, Linux, and macOS."
* **核心隐喻**: 它不是一个“笔记本”，而是一个 **“HUD (抬头显示器) 工作台”**。用户把信息丢进去，是为了**快速修正**、**参考对照**或**稍后调用**。

---

## 2. 三大核心支柱 (The 3 Strategic Pillars)

AI 在设计任何功能或界面时，必须严格通过以下三条原则的检验：

1. **极致简单 (Radical Simplicity)**
* **反复杂**: 拒绝 Ditto 式的复杂配置。没有脚本，没有复杂的网络同步设置。
* **零摩擦**: 默认配置即最优。用户只管 `Ctrl+C` 和 `Ctrl+Shift+V`。
* **核心流**: 收集 -> 轻处理 -> 召回。一切干扰这个流的功能都砍掉。


2. **顶格颜值 (Aesthetics First)**
* **反陈旧**: 拒绝 Win32/MFC 风格。UI 必须是现代化的 (Fluent/Material)。
* **视觉规范**: 支持深色模式 (Dark Mode)，必须有磨砂玻璃特效 (Blur/Mica)，列表滚动和窗口呼出必须有非线性丝滑动效 (Spring Animation)。
* **原则**: 丑就是 Bug。


3. **真·跨平台 (True Cross-Platform)**
* **Linux First**: Linux 不是二等公民。必须使用 **Rust (Tauri)** 构建，确保在 Linux (X11/Wayland) 上拥有原生级的剪切板监听和窗口管理能力。
* **统一体验**: Windows、macOS 和 Linux 的体验必须高度一致。



---

## 3. 竞品差异化 (Differentiation)

* **vs Paste**: ClipBox 是**“工作台”**，Paste 是“相册”。ClipBox 允许用户**修改内容**，允许把文字钉在屏幕上作为**代码参考 (HUD)**，且支持 Linux。
* **vs Ditto**: ClipBox 是**“现代工具”**，Ditto 是“古董”。ClipBox 拥有现代化 UI，且没有复杂的脚本门槛。
* **vs Snipaste**: ClipBox 是**“文本+图”双修**。Snipaste 只能钉图，ClipBox 能钉代码、钉报错信息、钉 API 接口。

---

## 4. 详细业务需求 (Functional Requirements)

### 模块 A: 智能采集 (Smart Capture)

* **无感监听**: 后台静默运行。自动去重（Hash 校验）。
* **上下文注入 (Context Injection)**: 每次复制时，必须调用 OS API 获取：
* `source_app`: 来源应用名称 (如 "VS Code")。
* `window_title`: 窗口标题 (如 "ClipBox PRD.md")。
* `source_url`: (如果可行) 浏览器 URL。


* **数据处理策略**:
* **文本**: 保留原始格式 (HTML/RTF) 以便原样粘贴，但清洗出纯文本用于预览和搜索。
* **图片**: **严禁存入 DB**。存文件系统，异步生成缩略图。
* **文件**: 仅存路径。



### 模块 B: 通用元数据与轻编辑 (Universal Meta & Light Edit)

* **通用性原则**: 无论是文本、图片还是文件，都必须拥有 `Tags` (标签) 和 `User Note` (备注)。
* **文本编辑 (The Weak Editor)**:
* 允许用户修改文本内容 (修正错别字、改参数)。
* **约束**: 纯文本编辑器。无富文本工具栏。


* **图片编辑**:
* 只读 (内容不可改)。
* 仅允许编辑 `Tags` 和 `User Note`。



### 模块 C: 召回与搜索 (Recall & Search)

* **UI 形态**: 垂直列表 (Spotlight 风格)。左侧图标，中间内容，右侧元数据。
* **混合搜索**: 输入关键词，必须同时匹配：
* `content` (文本内容)
* `ocr_text` (后台 OCR 识别出的图片文字)
* `tags` (标签)
* `user_note` (备注)


* **OCR 机制**: 图片入库后，后台异步任务调用 OCR 引擎，结果写入 DB 的 `ocr_text` 字段。

### 模块 D: 便签系统 (The HUD)

* **定义**: 便签是数据的**临时挂载点**。
* **交互**:
* `Ctrl+CC` (双击复制): 自动将当前内容弹射为便签。
* **双击便签**: **复制**内容 (Copy Action)，而非编辑。
* **右键便签**: 编辑标签/备注，或调节透明度。
* **关闭**: 归档回历史列表。



### 模块 E: 数据主权 (Data Sovereignty)

* **导入导出**: 必须提供 JSON 格式的导入导出接口。
* **本地优先**: SQLite 单机存储。

---

## 5. 技术架构与数据库设计 (Technical Architecture)

### 5.1 技术栈 (The Stack)

* **Backend**: **Rust** (Tauri v2) - 负责高性能 I/O、剪切板 Hook、SQLite、OCR。
* **Frontend**: **React** (TypeScript) + **Tailwind** + **Shadcn/UI** + **Framer Motion**。
* **Database**: **SQLite** (via SQLx or Rusqlite).

### 5.2 数据库 Schema (Future-Proof Design)

* 此 Schema 设计预留了 OCR 和 AI 字段，确保后续迭代无需重构 DB。

```sql
CREATE TABLE clipbox_items (
    id TEXT PRIMARY KEY,            -- UUID
    type TEXT NOT NULL,             -- 'text', 'image', 'file'
    
    -- 【内容层】
    content TEXT,                   -- 文本内容 (可编辑) 或 文件路径
    original_content TEXT,          -- 原始备份 (不可变)
    image_paths JSON,               -- {"thumb": "...", "raw": "..."} (图片专用)
    
    -- 【搜索层 - 预留扩展】
    ocr_text TEXT,                  -- [AI/OCR] 图片识别文本
    embedding BLOB,                 -- [AI/Vector] 向量数据 (预留)
    
    -- 【元数据层 - 通用且关键】
    tags JSON,                      -- ["#Work", "#Important"]
    user_note TEXT,                 -- 用户备注 (可编辑)
    metadata JSON,                  -- {"source_app": "Chrome", "window_title": "Github", "url": "..."}
    
    -- 【状态层】
    is_pinned BOOLEAN DEFAULT 0,    -- 是否为便签
    is_favorite BOOLEAN DEFAULT 0,  -- 收藏
    is_deleted BOOLEAN DEFAULT 0,   -- 软删除
    
    created_at INTEGER,
    updated_at INTEGER              -- 用于 LRU 排序
);

-- 索引优化
CREATE INDEX idx_search ON clipbox_items(content, ocr_text, user_note);
CREATE INDEX idx_updated ON clipbox_items(updated_at);

```

### 5.3 异步管道规范 (Async Pipeline Rule)

* **Rule**: 所有重型操作（图片压缩、OCR、AI 分析）必须在 Rust 的 `async` 线程中执行。
* **Flow**: Capture -> Save Raw -> Return to UI (Optimistic Update) -> Background Process (Compress/OCR) -> Update DB.

---

