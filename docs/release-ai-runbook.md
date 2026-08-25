# Qollect 发版 AI Runbook（长期维护）

## 1. 目标

本文件用于约束和指导 AI 在每次版本升级时，自动完成以下事情：

1. 更新版本号。
2. 补齐“本次更新说明”（中英文）。
3. 保持客户端弹窗、`latest.json`、GitHub Release、官网 changelog 使用同一份数据源。
4. 执行构建与发布，并做最小验收。

本项目约定：客户端只展示“当前版本一次性更新提示”，历史版本引导用户去官网查看完整更新日志。

---

## 2. 单一数据源（必须遵守）

所有版本说明以 `src/data/release-notes.json` 为唯一源头。

发版链路会自动复用该文件：

1. 客户端首次启动时的“本次更新”弹窗（只弹一次）。
2. GitHub Actions 发布流程生成的 `latest.json`（用于 Tauri updater）。
3. GitHub Actions 发布流程生成的 GitHub Release 文案。
4. 上传到 R2 的 `release-notes.json`（供官网渲染历史 changelog）。

禁止在多个地方手写重复的更新说明文本。

---

## 3. 每次发版 AI 必须收集的信息

当用户说“我要发版”时，AI 至少要确认这些字段（缺一不可）：

1. 目标版本号（例如 `0.2.5`）。
2. 中文摘要（1 句）。
3. 英文摘要（1 句）。
4. 中文要点列表（建议 3-5 条）。
5. 英文要点列表（建议 3-5 条）。
6. changelog 锚点（可选，默认 `#v<version-with-dashes>`）。

如果用户没给全，AI 要先补问，再开始改文件。

---

## 4. `release-notes.json` 结构规范

```json
{
  "changelogUrl": "https://qollect.zongqir.com/changelog",
  "releases": [
    {
      "version": "0.2.5",
      "publishedAt": "2026-03-02",
      "changelogUrl": "https://qollect.zongqir.com/changelog#v0-2-5",
      "summary": {
        "zh-CN": "一句中文摘要",
        "en-US": "One-line English summary"
      },
      "highlights": {
        "zh-CN": ["中文要点1", "中文要点2"],
        "en-US": ["English point 1", "English point 2"]
      }
    }
  ]
}
```

约束：

1. `version` 不带 `v` 前缀（写 `0.2.5`，不是 `v0.2.5`）。
2. 新版本条目追加到 `releases` 顶部（最新在前）。
3. `publishedAt` 使用 `YYYY-MM-DD`。
4. 中英文内容都要有，不能只写一个语言。

---

## 5. AI 标准执行流程（逐步）

### Step A：改版本号

至少同步以下文件（保持一致）：

1. `package.json` 的 `version`
2. `src-tauri/tauri.conf.json` 的 `version`

### Step B：写本次更新说明

更新 `src/data/release-notes.json`：

1. 插入新版本条目（见上方结构）。
2. 检查 JSON 格式合法。
3. 保留历史版本记录，不删除旧条目。

### Step C：本地校验（最少）

执行：

```bash
npm run build
```

若失败，先修复再继续发布。

### Step D：执行发布

使用 GitHub Actions 的 Release workflow 发布，不再使用本地 `release.ps1`。

标准方式：

1. 提交并推送包含版本号与 `release-notes.json` 的变更。
2. 由 `.github/workflows/release.yml` 自动：
   1. 构建安装包并签名。
   2. 基于 `src/data/release-notes.json` 生成 GitHub Release 文案。
   3. 生成 updater 使用的 `latest.json`。
   4. 上传 R2：
      1. 安装包 + 签名
      2. `latest.json`
      3. `release-notes.json`

若需手动触发，应在 GitHub Actions 页面执行对应 workflow，而不是运行本地发布脚本。

### Step E：发布后验收

最少检查：

1. GitHub Release 页面存在目标版本。
2. `https://dl.zongqir.com/latest.json` 可访问，版本号正确。
3. `https://dl.zongqir.com/release-notes.json` 可访问，且含当前版本条目。

---

## 6. AI 发版完成后的回报格式

AI 完成后应向用户回报：

1. 本次发版版本号。
2. 已修改文件清单。
3. 构建结果（成功/失败）。
4. 发布结果（GitHub、R2）。
5. 验收链接（latest.json、release-notes.json、release tag 链接）。
6. 若失败，明确失败步骤和下一步建议。

---

## 7. 给 AI 的触发口令（建议）

用户可直接使用下面任一口令触发完整流程：

1. `我要发版到 0.2.5，按 release-ai-runbook 全流程执行。`
2. `开始版本升级，目标 0.2.5，帮我补齐中英文更新说明并发布。`
3. `按 docs/release-ai-runbook.md 执行一次完整发版。`

---

## 8. 常见错误与处理

1. `release-notes.json` 没有当前版本条目：
   1. GitHub Release workflow 会缺少当前版本文案或直接失败。
   2. 处理：补齐条目后重新发布。
2. 版本号不一致（`package.json` 与 `tauri.conf.json`）：
   1. 可能导致显示和发布混乱。
   2. 处理：统一版本后重新构建。
3. R2 上传失败：
   1. 检查 GitHub Actions secrets 中的 Cloudflare 凭据与 bucket 权限。
   2. 必要时在 workflow 中重试或手工补传 `latest.json` 与 `release-notes.json`。

---

## 9. 维护要求

1. 本文档是 AI 发版标准流程，后续若发布链路变更，要同步更新此文档。
2. 新增发版脚本参数、分发平台、官网 changelog 渲染方式时，优先更新本文件再执行发版。
