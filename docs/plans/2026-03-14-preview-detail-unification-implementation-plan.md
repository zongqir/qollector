# 预览详情统一实施计划

日期：2026-03-14
对应设计：[2026-03-14-preview-detail-unification-design.md](D:/code/qollect/docs/plans/2026-03-14-preview-detail-unification-design.md)
范围：将“内容展示”独立预览收口到主窗口 `预览详情`
状态：Ready

## 1. 实施原则

1. 先统一入口与语义，再清理窗口服务与命名残留。
2. 保持 `PreviewPanel` 为唯一详情宿主，不额外引入第二套 overlay 容器。
3. 预览与编辑继续分离，`HistoryEditorWindow` 不在本轮合并。
4. 每一步都同时验证 normal / mini，以及历史流 / 收藏区 / 工作区三大区域。
5. 若发现某类内容只能依赖独立窗口能力，先补主窗口能力，再删除窗口分支，避免功能回退。

## 2. 当前实现基线

当前仓库内与详情浏览相关的主链路如下：

- 主窗口预览：
  - [PreviewPanel.jsx](D:/code/qollect/src/components/Panel/PreviewPanel.jsx)
  - [panelActions.js](D:/code/qollect/src/store/modules/panelActions.js)
  - [previewInteractionPolicy.js](D:/code/qollect/src/utils/previewInteractionPolicy.js)
- 历史流内联 / hover：
  - [InlinePreviewPanel.jsx](D:/code/qollect/src/components/HistoryStream/InlinePreviewPanel.jsx)
  - [HoverPreview/index.jsx](D:/code/qollect/src/components/HoverPreview/index.jsx)
- 独立窗口服务：
  - [windowService.js](D:/code/qollect/src/services/windowService.js)

已知关键现状：

1. 主窗口已经具备 `panelMode = 'preview'` 详情态。
2. `windowService.js` 仍保留 `openImagePreview` 这类独立预览窗口能力。
3. `HistoryEditorWindow` 与独立预览窗口都通过 `WebviewWindow` 创建，但两者职责不同。
4. i18n 中仍存在“内容展示”相关文案，需要统一收口到“预览详情”语义。

## 3. 目标交付边界

本轮实施只覆盖以下结果：

1. 所有普通详情浏览入口统一走主窗口 `预览详情`。
2. 取消“内容展示”独立预览窗口作为普通浏览入口。
3. 统一历史流 / 收藏区 / 工作区进入详情的返回语义。
4. 保持图片、文本、链接、文件在主窗口内的预览能力完整。
5. `HistoryEditorWindow` 继续保留。

不在本轮实施：

1. 合并 `HistoryEditorWindow` 到主窗口。
2. 重做 `PreviewPanel` 的整体视觉结构。
3. 统一重构 hover 预览与内联预览的所有样式细节。
4. 新增额外详情功能，例如多标签页预览、可拆分详情等。

## 4. 分阶段执行

### Phase 1A：语义与入口盘点

目标：先把所有“谁会打开独立预览窗”找全，并明确迁移范围。

涉及文件：

- [windowService.js](D:/code/qollect/src/services/windowService.js)
- [previewInteractionPolicy.js](D:/code/qollect/src/utils/previewInteractionPolicy.js)
- 历史流、收藏区、工作区相关卡片与快捷入口组件

任务：

1. 盘点所有调用独立预览窗口的入口。
2. 标记哪些入口属于普通详情浏览，哪些属于真正独立编辑或辅助能力。
3. 确认历史流 / 收藏区 / 工作区 / compare 的进入预览与返回路径。
4. 明确“内容展示”旧文案、旧日志、旧 title 的分布位置。

验收：

1. 所有普通详情入口都有明确迁移归属。
2. “独立预览窗”和“独立编辑窗”的边界被明确写清。

### Phase 1B：统一进入 `PreviewPanel`

目标：把普通详情浏览统一切到主窗口预览态。

涉及文件：

- [previewInteractionPolicy.js](D:/code/qollect/src/utils/previewInteractionPolicy.js)
- [panelActions.js](D:/code/qollect/src/store/modules/panelActions.js)
- 历史流 / 收藏区 / 工作区相关触发组件

任务：

1. 所有普通详情入口统一调用 `setPanelMode('preview', item, ...)` 或等价封装。
2. 确保进入预览时带上正确的 return context。
3. 清理仍直接分叉到独立预览窗的普通卡片点击链路。
4. compare -> preview -> compare 的已有链路保持不破。

验收：

1. 历史流、收藏区、工作区点击详情后都进入主窗口预览态。
2. 关闭预览后正确回原上下文。
3. 不再因为内容类型不同而跳出主窗口。

风险：

1. 某些边缘入口可能绕过 `previewInteractionPolicy`，需要逐个兜底。
2. 返回态若与 mini / normal 切换叠加，可能出现恢复错误。

### Phase 1C：补齐主窗口预览能力

目标：保证从独立窗口迁回主窗口后，用户能力不回退。

涉及文件：

- [PreviewPanel.jsx](D:/code/qollect/src/components/Panel/PreviewPanel.jsx)
- [preview.css](D:/code/qollect/src/styles/preview.css)
- [FilePreview.jsx](D:/code/qollect/src/components/Panel/FilePreview.jsx)
- [ImageLightbox](D:/code/qollect/src/components/ImageLightbox)

任务：

1. 补查图片查看主链路是否已经覆盖独立窗口能力。
2. 补查文件、链接、文本长内容在主窗口内是否都有稳定展示与操作。
3. 确保 mini 模式下依然可进入、返回、滚动与执行核心操作。
4. 若发现某项能力只在独立预览窗可用，优先补到 `PreviewPanel`，再做窗口下线。

验收：

1. 图片：可看、可放大、可返回。
2. 文件：可预览、可打开、可在文件夹中显示。
3. 文本 / 链接：可浏览、可复制、可打开相关目标。
4. mini / normal 表现一致，不再弹独立预览窗。

### Phase 1D：下线“内容展示”独立窗口

目标：真正从技术实现上移除普通独立预览窗。

涉及文件：

- [windowService.js](D:/code/qollect/src/services/windowService.js)
- 相关调用点
- 可能涉及 `public/preview.html` 及对应静态资源引用

任务：

1. 移除或废弃 `openImagePreview` 等仅为普通预览服务的窗口方法。
2. 清理对应调用点，避免残留死分支。
3. 如果 `public/preview.html` 不再承担任何必要职责，评估是否一并移除。
4. 保留 `HistoryEditorWindow`、widget、快速记录窗口等仍需独立窗口的能力。

验收：

1. 普通详情浏览路径不再创建新的预览 `WebviewWindow`。
2. `windowService.js` 职责更清晰，只保留真正需要独立窗口的能力。

风险：

1. 静态 preview 页可能被其他地方复用，删除前必须确认引用关系。
2. 若直接删除服务方法但调用点未清干净，容易留下运行时错误。

### Phase 1E：文案与命名清理

目标：收掉“内容展示”残留心智。

涉及文件：

- [zh-CN.json](D:/code/qollect/src/i18n/locales/zh-CN.json)
- [en-US.json](D:/code/qollect/src/i18n/locales/en-US.json)
- 服务日志与错误提示

任务：

1. 将对外文案中的“内容展示”统一收口为“预览详情”。
2. 调整相关 title、toast、错误提示，避免用户继续看到旧概念。
3. 对内部命名做最低限度清理，避免新增代码继续沿用“内容展示”语义。

验收：

1. UI 中不再出现“内容展示”作为普通预览概念。
2. 中英文文案语义一致。

## 5. 推荐实施顺序

推荐按两次代码提交推进：

1. 第一次提交完成 Phase 1A + 1B + 必要的 1C，先让所有入口统一进 `PreviewPanel`。
2. 第二次提交完成 Phase 1D + 1E，清理独立窗口与文案残留。

这样更容易定位回归：

1. 第一轮看交互与返回链路。
2. 第二轮看清理是否彻底。

## 6. 测试与验收清单

手工验证尺寸：

1. `320x450`
2. `375x667`
3. `560x700`
4. `800x600`

手工验证区域：

1. 历史流
2. 收藏区
3. 工作区

手工验证内容类型：

1. 文本
2. 图片
3. 链接
4. 文件

每种组合至少检查：

1. 进入详情
2. 返回原上下文
3. 滚动是否正常
4. 复制 / 收藏 / 置顶等主操作是否正常
5. mini 与 normal 是否都不再弹独立预览窗

## 7. 实施提醒

1. 本次不是“多做一个 overlay”，而是“少保留一个错误层级”。
2. 优先保障一致性，其次再谈视觉重做。
3. 如果实施中发现 `PreviewPanel` 承担能力不足，应先补能力，不要回退到继续保留独立预览窗。
