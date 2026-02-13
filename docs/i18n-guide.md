# ClipBox 国际化 (i18n) 使用指南

## 概述

ClipBox 现已支持多语言国际化，目前支持：
- 简体中文 (zh-CN)
- English (en-US)

## 功能特性

### 1. 语言切换
- **标题栏快速切换**：点击标题栏的 🌐 按钮可快速切换语言
- **设置页面切换**：在设置 → 通用设置中选择语言
- **自动保存**：语言选择会自动保存到本地存储

### 2. 已国际化的组件
- ✅ Settings 设置页面（完整支持）
- ✅ DragDrop 拖拽组件（完整支持）
- ✅ App 主界面（部分支持，标题栏和错误消息）

### 3. 语言文件位置
```
src/i18n/
├── index.js              # i18n 配置文件
└── locales/
    ├── zh-CN.json        # 简体中文翻译
    └── en-US.json        # 英文翻译
```

## 开发指南

### 在组件中使用翻译

```jsx
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();

  return (
    <div>
      <h1>{t('app.title')}</h1>
      <p>{t('settings.ai.testSuccess')}</p>
    </div>
  );
}
```

### 带参数的翻译

```jsx
// 在翻译文件中定义
{
  "error": {
    "loadFailed": "加载失败: {{error}}"
  }
}

// 在代码中使用
t('error.loadFailed', { error: errorMessage })
```

### 切换语言

```jsx
import { useTranslation } from 'react-i18next';

function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('language', lng);
  };

  return (
    <select value={i18n.language} onChange={(e) => changeLanguage(e.target.value)}>
      <option value="zh-CN">简体中文</option>
      <option value="en-US">English</option>
    </select>
  );
}
```

## 添加新语言

### 1. 创建新的语言文件
在 `src/i18n/locales/` 目录下创建新的 JSON 文件，例如 `ja-JP.json`（日语）

### 2. 在 i18n 配置中注册
编辑 `src/i18n/index.js`：

```js
import jaJP from './locales/ja-JP.json';

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS },
    'ja-JP': { translation: jaJP },  // 添加新语言
  },
  // ...
});
```

### 3. 在设置页面添加选项
编辑 `src/Settings.jsx`，在语言选择下拉框中添加新选项：

```jsx
<select value={i18n.language} onChange={(e) => changeLanguage(e.target.value)}>
  <option value="zh-CN">简体中文</option>
  <option value="en-US">English</option>
  <option value="ja-JP">日本語</option>
</select>
```

## 翻译键命名规范

```
{
  "模块名": {
    "子模块": {
      "具体功能": "翻译文本"
    }
  }
}
```

示例：
```json
{
  "settings": {
    "ai": {
      "provider": "AI Provider",
      "testSuccess": "AI connection successful!"
    }
  }
}
```

## 待完成的国际化工作

App.jsx 主界面中还有大量硬编码的中文文本需要替换，包括：
- 搜索框占位符
- 类型筛选按钮
- 工具栏按钮
- 项目卡片中的操作按钮
- 编辑模式的标签
- 加载状态提示

可以参考 `src/i18n/textReplacements.js` 文件中的映射表进行替换。

## 技术栈

- **i18next**: 核心国际化框架
- **react-i18next**: React 集成库
- **localStorage**: 持久化语言选择

## 注意事项

1. 所有用户可见的文本都应该使用 `t()` 函数包裹
2. 不要在翻译键中使用空格，使用点号分隔
3. 保持中英文翻译文件的键结构一致
4. 添加新翻译时，同时更新所有语言文件
5. 控制台日志和调试信息可以保持英文，不需要翻译
