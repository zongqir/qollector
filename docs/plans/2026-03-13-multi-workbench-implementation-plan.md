# 多工作台实施计划

日期：2026-03-13
对应设计：[2026-03-13-multi-workbench-design.md](D:/code/qollect/docs/plans/2026-03-13-multi-workbench-design.md)
范围：多工作台 Phase 1 可交付落地计划
状态：Ready

## 1. 实施原则

1. 采用增量改造，不一次性移除现有 `is_pinned` 链路。
2. 先搭数据与状态骨架，再迁移工作区主路径，最后补搜索与管理交互。
3. 保持 `pin <-> workbench`、`favorite <-> collection` 命名约束不被打破。
4. 工作区主列表继续走“后端筛选优先”。
5. 每一阶段都要兼顾正常模式与 mini 模式，不允许只在单一尺寸下成立。

## 2. 当前实现基线

当前仓库里，工作区主语义仍然完全绑定 `is_pinned`：

- 仓储查询：
  - [clipboard_repo.rs](D:/code/qollect/src-tauri/src/repository/clipboard_repo.rs)
- Tauri 命令：
  - [clipboard_commands.rs](D:/code/qollect/src-tauri/src/commands/clipboard_commands.rs)
- 前端工作区状态：
  - [baseState.js](D:/code/qollect/src/store/modules/baseState.js)
  - [filterActions.js](D:/code/qollect/src/store/modules/filterActions.js)
  - [workbenchActions.js](D:/code/qollect/src/store/modules/workbenchActions.js)
- 工作区主 UI：
  - [WorkbenchPanel.jsx](D:/code/qollect/src/components/Panel/WorkbenchPanel.jsx)
- 搜索请求构造：
  - [searchRequestBuilder.js](D:/code/qollect/src/utils/searchRequestBuilder.js)

已知关键链路：

1. `get_workbench_pinned_items` 当前返回全部 `is_pinned = 1` 条目。
2. `toggle_pin_item / pin_item` 当前只处理 pin 状态，不携带工作台上下文。
3. `addQuickNote` 当前是“创建条目 -> 再 pin”。
4. 工作区筛选状态已独立于历史流，但还没有“当前工作台”状态。

## 3. 目标交付边界

本实施计划只覆盖设计文档中的 Phase 1：

1. 数据迁移：支持 `workbenches + clipboard_items.workbench_id`
2. 当前工作台持久化与切换
3. 工作区只展示当前工作台内容
4. pin / 快捷笔记 / 快速输出写入当前工作台
5. 当前工作台内搜索与筛选
6. 工作台基础管理：创建、重命名、删除并迁移到默认工作台

不在本轮实现：

1. 一个条目属于多个工作台
2. 自动分流规则
3. 工作台模板、颜色、图标
4. 更复杂的全局工作台管理中心

## 4. 分阶段执行

### Phase 1A：后端数据骨架

目标：先让数据库和 Rust 模型能表达“条目属于某个工作台”。

涉及文件：

- [clipboard_repo.rs](D:/code/qollect/src-tauri/src/repository/clipboard_repo.rs)
- [models.rs](D:/code/qollect/src-tauri/src/core/models.rs)
- 可能新增：
  - [workbench_repo.rs](D:/code/qollect/src-tauri/src/repository/workbench_repo.rs) 或在现有 repo 中先共置实现

任务：

1. 为 `clipboard_items` 新增 `workbench_id TEXT NULL`。
2. 新增 `workbenches` 表，至少包含：
   - `id`
   - `name`
   - `is_default`
   - `sort_order`
   - `created_at`
   - `updated_at`
3. 新增 schema migration：
   - 创建 `workbenches`
   - 创建默认工作台
   - 将所有旧 `is_pinned = 1` 条目回填到默认工作台
4. 为 `clipboard_items(workbench_id)` 与 `workbenches(sort_order)` 建索引。
5. 在 Rust 模型层新增 `Workbench` 结构体。
6. 为 `SearchFilters` 新增：
   - `workbench_id: Option<String>`
   - `search_all_workbenches: Option<bool>` 或更清晰的 scope 字段

验收：

1. 升级旧数据库后，旧 pinned 条目全部落入默认工作台。
2. 新 schema 下原有 pinned/favorite 基本能力不回归。

风险：

1. SQLite 迁移需要保证对已有数据幂等。
2. 旧 `SELECT *` 映射到 `ClipboardItem` 时，新增字段后要确认 sqlx 反序列化兼容。

### Phase 1B：后端命令与服务层

目标：把“当前工作台”真正带入命令和仓储 API。

涉及文件：

- [clipboard_commands.rs](D:/code/qollect/src-tauri/src/commands/clipboard_commands.rs)
- [clipboard_manager.rs](D:/code/qollect/src-tauri/src/core/clipboard_manager.rs)
- [clipboard_repo.rs](D:/code/qollect/src-tauri/src/repository/clipboard_repo.rs)
- [main.rs](D:/code/qollect/src-tauri/src/main.rs)

任务：

1. 新增工作台命令：
   - `get_workbenches`
   - `create_workbench`
   - `rename_workbench`
   - `delete_workbench`
   - `set_item_workbench`
2. 扩展已有工作区命令：
   - `get_workbench_pinned_items(workbench_id)`
   - `reorder_workbench_pinned_items(workbench_id, ordered_ids)`
   - `pin_item(id, max_pinned, workbench_id)`
   - `toggle_pin_item(id, max_pinned, workbench_id?)`
3. 调整工作区查询逻辑：
   - 当前工作区列表只取指定 `workbench_id`
   - 排序仍沿用现有 `pin_order`
4. 调整移出工作区逻辑：
   - unpin 时清空 `workbench_id`
5. 扩展 `search_items_with_filters`：
   - 默认支持按 `workbench_id` 下推
   - 为“搜索全部工作台”预留明确分支

验收：

1. 命令层已经能完成“创建工作台、查询当前工作台条目、将条目加入指定工作台”。
2. 当前工作区主查询不再把所有 pinned 条目混在一起。

风险：

1. `toggle_pin_item` 目前被大量调用，改签名后前端改造范围会比较大。
2. `toggle` 语义在“当前工作台”场景下容易引入歧义，必要时优先让显式 `pin_item + unpin` 承担主路径。

### Phase 1C：前端状态骨架

目标：把“当前工作台”和工作台列表放进 store，并保持持久化。

涉及文件：

- [baseState.js](D:/code/qollect/src/store/modules/baseState.js)
- [filterActions.js](D:/code/qollect/src/store/modules/filterActions.js)
- [workbenchActions.js](D:/code/qollect/src/store/modules/workbenchActions.js)
- [storageKeys.js](D:/code/qollect/src/constants/storageKeys.js)
- [clipboardService.js](D:/code/qollect/src/services/clipboardService.js)

任务：

1. 新增工作台状态：
   - `workbenches`
   - `activeWorkbenchId`
   - `activeWorkbenchSearchScope`
   - `workbenchLoadingState`
2. 新增 localStorage key：
   - 当前工作台 ID
   - 工作台搜索范围
3. 包装新服务方法：
   - 获取工作台列表
   - 创建/重命名/删除工作台
   - 以指定工作台执行 pin / 获取 pinned items / reorder
4. 调整 `addQuickNote`：
   - 接收 `activeWorkbenchId`
   - 创建条目后 pin 到当前工作台
5. 调整 `clearAllPinned`：
   - 只清空当前工作台
6. 为删除工作台后的 fallback 加本地保护：
   - 当前工作台不存在时切到默认工作台

验收：

1. 前端启动后能恢复上次工作台。
2. 切换工作台会重新拉取工作台内容。
3. 快捷笔记与清空动作只影响当前工作台。

### Phase 1D：工作区 UI 主路径

目标：把“当前工作台”做成用户可见、可切换、可感知的主交互。

涉及文件：

- [WorkbenchPanel.jsx](D:/code/qollect/src/components/Panel/WorkbenchPanel.jsx)
- [workbench.css](D:/code/qollect/src/styles/workbench.css)
- 可新增：
  - [WorkbenchSwitcher.jsx](D:/code/qollect/src/components/Panel/WorkbenchSwitcher.jsx)
  - [WorkbenchManageDialog.jsx](D:/code/qollect/src/components/Panel/WorkbenchManageDialog.jsx) 或轻量弹层
- i18n：
  - [zh-CN.json](D:/code/qollect/src/i18n/locales/zh-CN.json)
  - [en-US.json](D:/code/qollect/src/i18n/locales/en-US.json)

任务：

1. 在工作区顶部增加独立工作台头部。
2. 显示当前工作台名胶囊，点击展开工作台切换器。
3. 支持：
   - 切换工作台
   - 新建工作台
   - 重命名非默认工作台
   - 删除非默认工作台
4. 工作区空态区分：
   - 当前工作台为空
   - 搜索无结果
   - 搜全部工作台入口
5. 所有“加入工作区”反馈文案改成带工作台名：
   - `已加入“博客评论”工作台`
6. 正常模式与 mini 模式均验证：
   - `320x450`
   - `375x667`
   - `560x700`
   - `800x600`

验收：

1. 用户始终能看见当前工作台。
2. 工作台切换器不挤爆筛选栏与快捷笔记。
3. 中英文下都能稳定显示，不出现长文案竖排挤压。

风险：

1. [WorkbenchPanel.jsx](D:/code/qollect/src/components/Panel/WorkbenchPanel.jsx) 已经较重，建议把切换器抽成独立组件。
2. 顶部新增一行后，mini 模式纵向空间会更紧，需要同步验证空态、列表、底部动作条。

### Phase 1E：搜索、筛选与跨工作台兜底

目标：保持默认语境隔离，同时解决“我把东西放哪了”的焦虑。

涉及文件：

- [searchRequestBuilder.js](D:/code/qollect/src/utils/searchRequestBuilder.js)
- [WorkbenchPanel.jsx](D:/code/qollect/src/components/Panel/WorkbenchPanel.jsx)
- [clipboard_repo.rs](D:/code/qollect/src-tauri/src/repository/clipboard_repo.rs)
- [models.rs](D:/code/qollect/src-tauri/src/core/models.rs)

任务：

1. 工作区搜索默认追加 `activeWorkbenchId`。
2. 当前工作台搜索无结果时，给出“搜索全部工作台”入口。
3. 跨工作台搜索结果需显示所属工作台。
4. 点击跨工作台结果后：
   - 切换到对应工作台
   - 聚焦结果条目
5. 保持类型、标签、日期、收藏等筛选都在当前工作台作用域内生效。

验收：

1. 默认搜索不会混入其他工作台条目。
2. 显式全局搜索时，结果带归属工作台并可跳转。

## 5. 推荐实施顺序

推荐分两次代码提交推进：

### 提交 1：数据与状态骨架

包含：

1. migration
2. Rust workbench model 与命令
3. store 中的 `activeWorkbenchId / workbenches`
4. 服务层改造

不包含：

1. UI 切换器
2. 跨工作台搜索入口

原因：

先把骨架搭起来，可以先用默认工作台跑通旧行为，降低一上来前后端同时大改的回归风险。

### 提交 2：工作区 UI 与交互

包含：

1. 顶部工作台切换器
2. 当前工作台加载与切换
3. 归属反馈文案
4. 当前工作台搜索与全局兜底

## 6. 手工验证清单

### 数据迁移

1. 使用旧数据启动后，旧 pinned 条目全部出现在默认工作台。
2. 收藏区数据不受影响。

### 当前工作台写入

1. 在默认工作台 pin 内容，内容进入默认工作台。
2. 新建“博客评论”工作台后，在其中 pin 内容，内容只出现在“博客评论”。
3. 在“博客评论”工作台输入快捷笔记，条目只进入“博客评论”。
4. 在“博客评论”工作台运行 quick output，产物只进入“博客评论”。

### 切换与管理

1. 切换工作台后列表内容立即更新。
2. 重启应用后恢复上次工作台。
3. 删除非默认工作台后，内容迁移到默认工作台且当前视图不崩。

### 搜索与筛选

1. 当前工作台搜索只返回当前工作台结果。
2. 搜全部工作台时，结果能标出所属工作台。
3. 标签、日期、类型、收藏筛选在当前工作台仍然正确。

### 尺寸验证

1. `320x450`
2. `375x667`
3. `560x700`
4. `800x600`

## 7. 建议的第一步实现

如果立即开始编码，建议先做 Phase 1A + Phase 1B 中最小闭环：

1. migration
2. `Workbench` Rust 模型
3. `get_workbenches`
4. `get_workbench_pinned_items(workbench_id)`
5. `pin_item(id, max_pinned, workbench_id)`
6. 旧数据回填默认工作台

原因：

只要这个闭环成立，前端即使暂时还没有新 UI，也可以先用固定默认工作台把底层行为切到新模型上，后续 UI 改造会顺很多。
