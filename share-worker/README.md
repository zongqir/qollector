# Qollect 端到端加密分享中继 (Share Relay)

这是专为 [Qollect](https://github.com/zongqir/qollector) 设计的极简、端到端加密（E2EE）、10 分钟阅后即焚分享中继服务，基于 Cloudflare Workers + KV 构建。

---

## 核心设计与隐私安全机制

1. **零知识存储（Zero-Knowledge）**：
   - 发送端（Qollect 桌面端）在本地通过浏览器原生 Web Crypto（AES-256-GCM）生成随机会话密钥并完成加密；
   - 服务器仅暂存密文与初始向量（IV），没有任何解密能力；
   - 包含解密密钥的字符串仅保存在二维码 URL 的 `#KEY`（URL Hash 锚点）中。根据 HTTP 协议标准，URL Hash **永远不会发送至服务器**，密钥仅在手机本地内存中解密使用。
2. **物理层自动销毁（Auto-Purge）**：
   - 数据写入 Cloudflare KV 时显式指定 `expirationTtl: 600`（10 分钟后物理失效并自动销毁）；
   - 超时后再次访问，直接显示失效提示，服务端零历史留存。
3. **极简开箱可用，无外部依赖**：
   - 单文件 `worker.js`，内嵌自适应暗黑现代落地页；
   - 适配移动端微信内置浏览器与 iOS / 安卓原生扫码器，提供大号【一键复制全文】按钮与受限复制降级保护。

---

## 3 分钟一键部署指南

如果你想自建专属的中继端点（或者使用自己的独立域名）：

### 1. 安装 Wrangler CLI 并登录

```bash
npm install -g wrangler
wrangler login
```

### 2. 创建 Cloudflare KV 命名空间

进入 `share-worker` 目录并创建存储：

```bash
cd share-worker
wrangler kv namespace create SHARE_KV
```

执行后终端会输出类似以下配置：

```toml
[[kv_namespaces]]
binding = "SHARE_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

将上面输出的 `id` 复制并替换到 `share-worker/wrangler.toml` 文件中。

### 3. 发布部署上线

```bash
wrangler deploy
```

发布完成后，Cloudflare 终端会返回一个 Workers 访问地址，例如：
`https://qollect-share-relay.<your-subdomain>.workers.dev`

### 4. 绑定自定义域名（强力推荐）

> [!IMPORTANT]
> 由于 Cloudflare 的默认域名 `*.workers.dev` 在中国大陆部分地区存在 DNS 污染或阻断，**强烈建议在 Cloudflare 控制台给该 Worker 绑定你的自定义域名**（例如 `qollect-share.zongqir.com`）：
> 1. 进入 Cloudflare Dashboard -> **Workers & Pages** -> 点击 `qollect-share-relay`；
> 2. 进入 **Settings** -> **Domains & Routes** -> **Add Custom Domain**；
> 3. 填入你的子域名（如 `qollect-share.zongqir.com`）并确认解析；
> 4. 国内移动 5G 即可全球 Anycast CDN 秒级直连。

---

## 在 Qollect 桌面端配置

1. 打开 Qollect，进入 **设置** -> **集成与服务**；
2. 找到 **自定义分享中继端点**；
3. 填入你的部署地址（例如 `https://qollect-share.zongqir.com`）；
4. 保存后，客户端所有长文本与图片跨网分享将自动通过你的专属 E2EE 中继极速流转！
