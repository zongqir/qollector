#!/bin/bash
# MCP 测试脚本

PORT=${1:-38470}  # 默认端口 38470，可通过参数指定

echo "=== ClipBox MCP 测试 (端口: $PORT) ==="
echo ""

# 1. 健康检查
echo "1. 健康检查..."
curl -s http://localhost:$PORT/health | jq .
echo ""

# 2. 初始化
echo "2. 初始化 MCP..."
curl -s -X POST http://localhost:$PORT/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }' | jq .
echo ""

# 3. 获取工具列表
echo "3. 获取工具列表..."
curl -s -X POST http://localhost:$PORT/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }' | jq .
echo ""

# 4. 获取最近记录
echo "4. 获取最近 5 条记录..."
curl -s -X POST http://localhost:$PORT/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "clipbox_recent",
      "arguments": {
        "limit": 5
      }
    }
  }' | jq .
echo ""

# 5. 搜索
echo "5. 搜索包含 'test' 的记录..."
curl -s -X POST http://localhost:$PORT/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "clipbox_search",
      "arguments": {
        "query": "test",
        "limit": 3
      }
    }
  }' | jq .
echo ""

# 6. 获取统计信息
echo "6. 获取统计信息..."
curl -s -X POST http://localhost:$PORT/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
      "name": "clipbox_stats",
      "arguments": {}
    }
  }' | jq .
echo ""

echo "=== 测试完成 ==="
