# ClipBox MCP 集成指南

## 概述

ClipBox 现已集成 MCP (Model Context Protocol) 服务器，允许 AI 助手（如 Claude Desktop）直接访问和操作你的剪贴板历史。

**通信方式：** HTTP REST API（默认端口 3847）

## 功能特性

### 可用工具

1. **clipbox_search** - 搜索剪贴板历史
   - 参数：`query` (搜索关键词), `limit` (结果数量，默认 20)
   - 支持搜索内容、标签、笔记、来源应用

2. **clipbox_recent** - 获取最近的剪贴板记录
   - 参数：`limit` (结果数量，默认 10)

3. **clipbox_get** - 获取指定剪贴板条目
   - 参数：`id` (条目 ID)

4. **clipbox_add** - 添加新的剪贴板条目
   - 参数：`content` (文本内容), `notes` (可选备注)
   - 仅支持文本类型

5. **clipbox_delete** - 删除指定条目
   - 参数：`id` (条目 ID)

6. **clipbox_stats** - 获取剪贴板统计信息
   - 返回总数、类型分布、置顶数、收藏数等

## 配置方法

### 1. 启用 MCP 服务

在 ClipBox 设置中：
1. 打开设置 → MCP 服务
2. 确保"启用 MCP 服务"已勾选（默认开启）
3. 可选：修改 HTTP 端口（默认 3847）
4. 保存设置并重启 ClipBox

### 2. 配置 Claude Desktop

编辑 Claude Desktop 配置文件：

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

**macOS:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Linux:**
```
~/.config/Claude/claude_desktop_config.json
```

添加以下配置：

```json
{
  "mcpServers": {
    "clipbox": {
      "url": "http://localhost:3847/mcp"
    }
  }
}
```

> 注意：如果修改了端口，请相应更新 URL 中的端口号。

### 3. 重启 Claude Desktop

配置完成后，重启 Claude Desktop 使配置生效。

## 使用示例

配置完成后，你可以在 Claude Desktop 中这样使用：

```
"帮我搜索剪贴板中包含 'API' 的内容"
"显示我最近复制的 5 条记录"
"获取剪贴板统计信息"
"帮我添加一条笔记到剪贴板"
```

Claude 会自动调用 ClipBox 的 MCP 工具来完成这些操作。

## 技术细节

### 通信协议

- 协议：JSON-RPC 2.0
- 传输：HTTP POST
- 端点：`http://localhost:3847/mcp`
- 健康检查：`http://localhost:3847/health`

### 安全性

- MCP 服务器仅监听本地回环地址（127.0.0.1）
- 不接受外部网络连接
- 所有操作都在本地执行
- 可随时在设置中关闭 MCP 服务

### 架构设计

```
Claude Desktop / AI Client
    ↕ HTTP (JSON-RPC)
ClipBox MCP Server (localhost:3847)
    ↕ 内部 API
ClipBox Core
    ↕
SQLite Database
```

## 故障排查

### MCP 服务无法连接

1. 确认 ClipBox 正在运行
2. 检查设置中 MCP 服务是否已启用
3. 验证端口是否被占用：`netstat -ano | findstr 3847`
4. 测试健康检查：`curl http://localhost:3847/health`
5. 重启 ClipBox

### 工具调用失败

1. 查看 ClipBox 控制台输出（开发模式）
2. 确认数据库文件未损坏
3. 检查是否有足够的磁盘空间
4. 使用测试脚本验证：`bash test_mcp.sh`

### 端口冲突

如果 3847 端口被占用：
1. 在 ClipBox 设置中修改端口
2. 更新 Claude Desktop 配置中的 URL
3. 重启 ClipBox

## 开发者信息

### 模块结构

```
src-tauri/src/mcp/
├── mod.rs          # 模块入口
├── config.rs       # MCP 配置
├── protocol.rs     # JSON-RPC 协议定义
├── server.rs       # MCP 服务器实现
└── tools.rs        # 工具集实现
```

### 扩展新工具

在 `tools.rs` 中添加新工具：

```rust
McpTool {
    name: "clipbox_your_tool".to_string(),
    description: "工具描述".to_string(),
    input_schema: json!({
        "type": "object",
        "properties": {
            "param": {
                "type": "string",
                "description": "参数描述"
            }
        },
        "required": ["param"]
    }),
}
```

然后在 `call_tool` 方法中实现逻辑。

## 未来计划

- [ ] 支持 WebSocket 实时通知
- [ ] 添加更多工具（批量操作、导出等）
- [ ] 支持图片和文件的 MCP 访问
- [ ] 添加权限控制和审计日志
- [ ] 支持 HTTPS（可选）

## 测试

使用提供的测试脚本：

```bash
bash test_mcp.sh
```

或手动测试：

```bash
# 健康检查
curl http://localhost:3847/health

# 获取工具列表
curl -X POST http://localhost:3847/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'

# 获取最近记录
curl -X POST http://localhost:3847/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "clipbox_recent",
      "arguments": {"limit": 5}
    }
  }'
```

## 反馈

如有问题或建议，请在 GitHub 提交 Issue。
