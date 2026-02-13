// 这个文件包含了 App.jsx 中需要替换的文本映射
// 使用方法：在 App.jsx 中导入 useTranslation，然后使用 t() 函数替换硬编码的中文文本

export const APP_TEXT_REPLACEMENTS = {
  // 搜索和筛选
  '搜索内容、标签、备注...': 'search.placeholder',
  '全部': 'search.typeFilter.all',
  '文本': 'search.typeFilter.text',
  '图片': 'search.typeFilter.image',
  '文件': 'search.typeFilter.file',
  '链接': 'search.typeFilter.link',

  // 工具栏
  '设置': 'toolbar.settings',
  '标签筛选': 'toolbar.tagFilter',
  '搜索标签...': 'toolbar.searchTags',
  '清除筛选': 'toolbar.clearFilter',

  // 项目操作
  '已置顶': 'item.pinned',
  '置顶': 'item.pin',
  '取消置顶': 'item.unpin',
  '复制': 'item.copy',
  '已复制': 'item.copied',
  'AI标签': 'item.aiTag',
  '生成中': 'item.generating',
  'OCR识别': 'item.ocr',
  '识别中': 'item.recognizing',
  '添加备注': 'item.addNote',
  '编辑备注': 'item.editNote',
  '展开': 'item.expand',
  '收起': 'item.collapse',
  '添加标签': 'item.addTag',
  '单击复制': 'item.clickToCopy',
  '双击预览': 'item.doubleClickToPreview',
  '双击编辑': 'item.doubleClickToEdit',
  '识别文本': 'item.recognizedText',

  // 编辑
  '内容:': 'edit.content',
  '备注:': 'edit.note',
  '添加备注...': 'edit.notePlaceholder',
  '保存': 'edit.save',
  '取消': 'edit.cancel',
  '输入标签名...': 'edit.addTagPlaceholder',

  // 加载状态
  '加载中...': 'app.loading',
  '暂无剪贴板历史': 'app.noItems',
};
