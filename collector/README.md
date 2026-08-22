# Qollect Collector

一个只负责收集剪贴板文本事件的最小服务。它不调用 AI、不使用数据库，也不维护客户端待上传队列。

## AI 与部署入口

后续让 AI 部署或修改此服务时，先阅读本 README。它是 Collector 部署方式、环境变量、网络边界和 HTTP 契约的唯一入口；不要把桌面客户端的 `npm run tauri build` / Release 流程用于此服务。

按任务继续读取：

| 场景 | 必读文件 |
| --- | --- |
| 已有 Caddy/Nginx 等 HTTPS 反向代理 | `docker-compose.yml`、`.env.example` |
| 没有反向代理，需要本服务自动申请 HTTPS 证书 | `docker-compose.standalone.yml`、`Caddyfile`、`.env.example` |
| 修改 Collector 接收、鉴权、文本截断、归档或保留规则 | `main.go`、`main_test.go` |
| 发布多架构 Docker 镜像 | `../.github/workflows/collector-image.yml` |

`docker-compose.yml` 和 `docker-compose.standalone.yml` 只能选择一个：前者复用已有反向代理，后者自带 Caddy 并独占宿主机 `80/443`。

## 启动

```bash
cp .env.example .env
# 编辑 .env，至少替换 QOLLECT_TOKEN
docker compose up -d
```

默认 Compose 只启动 Collector，并绑定到 `127.0.0.1:18080`，适合复用服务器已有的 Caddy/Nginx。现有反向代理转发到 `http://127.0.0.1:18080` 即可。

没有现成反向代理时使用独立模式：

```bash
docker compose -f docker-compose.standalone.yml up -d
```

独立模式会启动一个 Caddy，并占用宿主机 `80/443`。先在 `.env` 中设置真实域名，Caddy 会自动申请和续期 HTTPS 证书。镜像尚未存在或需要本地开发时，增加 `--build` 即可。

如果服务器已有 Caddy，不要启动独立模式，避免两个容器竞争 `80/443`。

默认 Compose 使用 GHCR 公共镜像。GHCR 允许公开匿名拉取；GitHub Actions 使用仓库自带的 `GITHUB_TOKEN` 推送，不需要额外配置镜像仓库密码。

## 镜像发布

GitHub Actions 在推送 `collector-v0.1.0` 这类标签时发布 GHCR 镜像。首次发布后，需要在 GitHub Package 设置中将该包设为 Public，用户即可匿名拉取。

任何公共镜像仓库都要求推送方认证；“公共”指匿名拉取，不代表可以匿名推送。因此本项目先只使用 GHCR，不把国内镜像仓库作为发布前置条件。后续如果确实需要国内镜像，再增加同步步骤即可。

日志会写入 `./data`，按服务端时区归档：

```text
data/events/2026/08/22.jsonl
```

## 接口

健康检查不需要 Token：

```text
GET /healthz
```

上传接口需要 Bearer Token：

```text
POST /v1/clipboard-events
Authorization: Bearer <QOLLECT_TOKEN>
Content-Type: application/json
```

请求示例：

```json
{
  "event_id": "local-item-id",
  "captured_at": "2026-08-22T10:20:30.000Z",
  "content_type": "text/plain",
  "content": "clipboard text",
  "source_app": "example.exe"
}
```

只接受文本类型。图片、二进制和其他类型会返回 `415`。超过 `QOLLECT_MAX_TEXT_CHARS` 的文本只保存前 `QOLLECT_PREVIEW_CHARS` 个 Unicode 字符，并标记 `truncated: true`，同时保留原始字符数和 SHA-256。

每个来源 IP 每分钟最多接受 120 条上传请求；超过后返回 `429`。这是一个轻量防刷限制，公网部署仍建议放在 HTTPS 反向代理和防火墙后面。

服务只保留成功接收的事件。客户端上传失败不会在 Collector 侧形成长期积压；过期 JSONL 文件会按 `QOLLECT_RETENTION_DAYS` 自动清理。

生产环境建议把服务放在现有 HTTPS 反向代理后面，不要直接把 HTTP 端口暴露到公网。
