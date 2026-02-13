# ClipBox MCP 快速开始

## 1. 启动 ClipBox

MCP 服务器会自动启动（默认端口 38470）

## 2. 配置 Claude Desktop

编辑配置文件：
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

添加配置：
```json
{
  "mcpServers": {
    "clipbox": {
      "url": "http://localhost:38470/mcp"
    }
  }
}
```

> 💡 提示：在 ClipBox 设置 → MCP 服务中可以直接复制配置

## 3. 重启 Claude Desktop

配置生效后，Claude 就能访问你的剪贴板了！

## 可用功能

- 🔍 **搜索剪贴板**: "帮我搜索剪贴板中包含 'API' 的内容"
- 📋 **获取最近记录**: "显示我最近复制的 5 条记录"
- 📊 **查看统计**: "我的剪贴板有多少条记录？"
- ➕ **添加内容**: "帮我添加一条笔记到剪贴板"
- 🗑️ **删除记录**: "删除 ID 为 xxx 的记录"

## 端口说明

- 默认端口: **38470**
- 如果被占用，会自动切换到 38471, 38472...
- 实际端口显示在设置界面

## 测试连接

```bash
# 健康检查
curl http://localhost:38470/health

# 获取统计信息
curl -X POST http://localhost:38470/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"clipbox_stats","arguments":{}}}'
```

## 故障排查

**无法连接？**
1. 确认 ClipBox 正在运行
2. 检查设置中 MCP 服务是否启用
3. 验证端口：`netstat -ano | findstr 38470`
4. 重启 ClipBox

**端口冲突？**
- ClipBox 会自动切换端口
- 查看设置界面的实际端口
- 更新 Claude Desktop 配置中的端口号

## 安全说明

- 仅监听本地回环地址（127.0.0.1）
- 不接受外部网络连接
- 可随时在设置中关闭
