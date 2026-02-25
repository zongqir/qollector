use serde_json::{json, Value};
use std::sync::Arc;
use thiserror::Error;

use super::protocol::McpTool;
use crate::core::clipboard_manager::ClipboardManager;

#[derive(Error, Debug)]
pub enum ToolError {
    #[error("工具未找到: {0}")]
    NotFound(String),
    #[error("参数错误: {0}")]
    InvalidArguments(String),
    #[error("执行失败: {0}")]
    ExecutionFailed(String),
}

/// 剪贴板工具集
#[derive(Clone)]
pub struct ClipboardTools {
    clipboard_manager: Arc<ClipboardManager>,
}

impl ClipboardTools {
    pub fn new(clipboard_manager: Arc<ClipboardManager>) -> Self {
        Self { clipboard_manager }
    }

    /// 列出所有可用工具
    pub fn list_tools(&self) -> Vec<McpTool> {
        vec![
            McpTool {
                name: "qollect_search".to_string(),
                description: "搜索剪贴板历史记录。支持按内容、标签、笔记、来源应用搜索。"
                    .to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "搜索关键词"
                        },
                        "limit": {
                            "type": "integer",
                            "description": "返回结果数量限制 (默认 20)",
                            "default": 20
                        }
                    },
                    "required": ["query"]
                }),
            },
            McpTool {
                name: "qollect_recent".to_string(),
                description: "获取最近的剪贴板记录".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "limit": {
                            "type": "integer",
                            "description": "返回结果数量 (默认 10)",
                            "default": 10
                        }
                    }
                }),
            },
            McpTool {
                name: "qollect_get".to_string(),
                description: "根据 ID 获取指定剪贴板条目的详细信息".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "id": {
                            "type": "string",
                            "description": "剪贴板条目 ID"
                        }
                    },
                    "required": ["id"]
                }),
            },
            McpTool {
                name: "qollect_add".to_string(),
                description: "添加新的剪贴板条目 (仅支持文本)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "文本内容"
                        },
                        "notes": {
                            "type": "string",
                            "description": "可选的笔记"
                        }
                    },
                    "required": ["content"]
                }),
            },
            McpTool {
                name: "qollect_delete".to_string(),
                description: "删除指定的剪贴板条目".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "id": {
                            "type": "string",
                            "description": "要删除的条目 ID"
                        }
                    },
                    "required": ["id"]
                }),
            },
            McpTool {
                name: "qollect_stats".to_string(),
                description: "获取剪贴板统计信息 (总条目数、类型分布等)".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {}
                }),
            },
        ]
    }

    /// 调用工具
    pub async fn call_tool(&self, name: &str, arguments: Value) -> Result<Value, ToolError> {
        match name {
            "qollect_search" => self.search(arguments).await,
            "qollect_recent" => self.recent(arguments).await,
            "qollect_get" => self.get(arguments).await,
            "qollect_add" => self.add(arguments).await,
            "qollect_delete" => self.delete(arguments).await,
            "qollect_stats" => self.stats(arguments).await,
            _ => Err(ToolError::NotFound(name.to_string())),
        }
    }

    /// 搜索剪贴板
    async fn search(&self, args: Value) -> Result<Value, ToolError> {
        let query = args["query"]
            .as_str()
            .ok_or_else(|| ToolError::InvalidArguments("缺少 query 参数".to_string()))?;
        let limit = args["limit"].as_i64().unwrap_or(20) as usize;

        match self.clipboard_manager.search_items(query, limit).await {
            Ok(items) => Ok(json!({
                "items": items,
                "count": items.len()
            })),
            Err(e) => Err(ToolError::ExecutionFailed(e.to_string())),
        }
    }

    /// 获取最近记录
    async fn recent(&self, args: Value) -> Result<Value, ToolError> {
        let limit = args["limit"].as_i64().unwrap_or(10) as usize;

        match self.clipboard_manager.get_recent_items(limit).await {
            Ok(items) => Ok(json!({
                "items": items,
                "count": items.len()
            })),
            Err(e) => Err(ToolError::ExecutionFailed(e.to_string())),
        }
    }

    /// 获取指定条目
    async fn get(&self, args: Value) -> Result<Value, ToolError> {
        let id = args["id"]
            .as_str()
            .ok_or_else(|| ToolError::InvalidArguments("缺少 id 参数".to_string()))?;

        match self.clipboard_manager.get_item_by_id(id).await {
            Ok(Some(item)) => Ok(json!(item)),
            Ok(None) => Err(ToolError::ExecutionFailed(format!("条目不存在: {}", id))),
            Err(e) => Err(ToolError::ExecutionFailed(e.to_string())),
        }
    }

    /// 添加条目
    async fn add(&self, args: Value) -> Result<Value, ToolError> {
        let content = args["content"]
            .as_str()
            .ok_or_else(|| ToolError::InvalidArguments("缺少 content 参数".to_string()))?;
        let notes = args["notes"].as_str();

        match self.clipboard_manager.add_text_item(content, notes).await {
            Ok(item) => Ok(json!({
                "success": true,
                "item": item
            })),
            Err(e) => Err(ToolError::ExecutionFailed(e.to_string())),
        }
    }

    /// 删除条目
    async fn delete(&self, args: Value) -> Result<Value, ToolError> {
        let id = args["id"]
            .as_str()
            .ok_or_else(|| ToolError::InvalidArguments("缺少 id 参数".to_string()))?;

        match self.clipboard_manager.delete_item(id).await {
            Ok(_) => Ok(json!({
                "success": true,
                "message": "删除成功"
            })),
            Err(e) => Err(ToolError::ExecutionFailed(e.to_string())),
        }
    }

    /// 获取统计信息
    async fn stats(&self, _args: Value) -> Result<Value, ToolError> {
        match self.clipboard_manager.get_statistics().await {
            Ok(stats) => Ok(json!(stats)),
            Err(e) => Err(ToolError::ExecutionFailed(e.to_string())),
        }
    }
}
