# AI请求串行化实现

## 问题背景

在自动AI标签生成功能中，如果用户快速复制多个内容，会导致：

1. **API限流**：多个并发请求触发服务商的速率限制（Rate Limiting）
2. **成本激增**：同时发送大量请求，增加API调用成本
3. **资源竞争**：多个请求同时执行，消耗大量系统资源
4. **请求失败**：超过并发限制导致部分请求失败

## 解决方案

使用 Tokio 的 `Semaphore` 信号量机制，确保同一时间只有一个AI请求在执行。

### 实现细节

#### 1. 添加信号量字段

```rust
pub struct ClipboardManager {
    // ... 其他字段
    ai_semaphore: Arc<Semaphore>, // AI请求串行化控制
}
```

#### 2. 初始化信号量

```rust
Self {
    // ... 其他字段
    ai_semaphore: Arc::new(Semaphore::new(1)), // 只允许1个AI请求同时执行
}
```

#### 3. 使用信号量保护AI请求

```rust
// 获取信号量许可，确保AI请求串行执行
let _permit = ai_semaphore_clone.acquire().await.unwrap();
println!("🔒 获取AI请求锁，生成标签: item_id={}", item_id);

// 执行AI请求
let service = AIService::new(ai_config);
match service.generate_tags(content).await {
    // ... 处理结果
}

// _permit 在这里自动释放
println!("🔓 释放AI请求锁");
```

## 工作原理

### 信号量机制

```
请求1: 🔒 获取锁 → 执行AI请求 → 🔓 释放锁
请求2:     等待...    🔒 获取锁 → 执行AI请求 → 🔓 释放锁
请求3:          等待...         🔒 获取锁 → 执行AI请求 → 🔓 释放锁
```

### 执行流程

1. **请求到达**：后台任务尝试获取信号量许可
2. **等待队列**：如果已有请求在执行，新请求进入等待队列
3. **获取许可**：前一个请求完成后，下一个请求获得许可
4. **执行请求**：持有许可期间独占执行AI请求
5. **自动释放**：`_permit` 离开作用域时自动释放许可

## 效果对比

### 之前（并发执行）

```
时间轴: 0s    1s    2s    3s    4s
请求1: |--AI请求--|
请求2: |--AI请求--|
请求3: |--AI请求--|
请求4: |--AI请求--|
请求5: |--AI请求--|

问题：
- 5个请求同时发送
- 可能触发API限流
- 成本 = 5 * 单价
```

### 之后（串行执行）

```
时间轴: 0s    1s    2s    3s    4s    5s    6s    7s    8s    9s
请求1: |--AI请求--|
请求2:             |--AI请求--|
请求3:                         |--AI请求--|
请求4:                                     |--AI请求--|
请求5:                                                 |--AI请求--|

优势：
- 请求依次执行
- 不会触发API限流
- 成本 = 5 * 单价（相同，但更稳定）
- 避免请求失败
```

## 性能影响

### 延迟增加

- **单个请求**：无影响，立即执行
- **多个请求**：后续请求需要等待前面的请求完成
- **用户体验**：后台执行，用户无感知

### 优势

1. **稳定性提升**：避免API限流导致的请求失败
2. **成本可控**：不会因并发导致意外的高额费用
3. **资源优化**：避免同时执行多个AI请求消耗过多资源
4. **可预测性**：请求按顺序执行，行为可预测

## 配置选项

### 当前配置

```rust
Semaphore::new(1)  // 同时只允许1个请求
```

### 未来可扩展

可以将并发数设为可配置项：

```rust
// 在 AIConfig 中添加
pub struct AIConfig {
    // ... 其他字段
    pub max_concurrent_requests: usize, // 最大并发请求数
}

// 使用配置创建信号量
ai_semaphore: Arc::new(Semaphore::new(config.max_concurrent_requests))
```

## 日志输出

### 正常执行

```
🔒 获取AI请求锁，生成标签: item_id=abc123
✅ AI标签已自动添加: ["标签1", "标签2"]
🔓 释放AI请求锁
```

### 串行等待

```
🔒 获取AI请求锁，生成标签: item_id=aaa
✅ AI标签已自动添加: ["标签1"]
🔓 释放AI请求锁
🔒 获取AI请求锁，生成标签: item_id=bbb  ← 等待前一个完成
✅ AI标签已自动添加: ["标签2"]
🔓 释放AI请求锁
```

## 注意事项

1. **OCR不受影响**：OCR请求不使用信号量，可以并发执行
2. **自动释放**：使用 RAII 模式，`_permit` 离开作用域自动释放
3. **错误处理**：即使AI请求失败，许可也会正确释放
4. **跨任务共享**：所有后台任务共享同一个信号量

## 测试场景

### 场景1：快速复制多个文本

```
操作：连续复制5段文本
预期：AI请求依次执行，不会并发
结果：✅ 所有请求成功，无限流
```

### 场景2：快速复制多张图片

```
操作：连续复制3张图片
预期：OCR并发执行，AI请求串行执行
结果：✅ OCR快速完成，AI标签依次生成
```

### 场景3：混合复制

```
操作：交替复制文本和图片
预期：所有AI请求串行执行
结果：✅ 按复制顺序依次处理
```

## 相关代码

- `src-tauri/src/core/clipboard_manager.rs`: 主要实现
- `src-tauri/Cargo.toml`: 依赖 `tokio` 的 `sync` 特性

## 参考资料

- [Tokio Semaphore 文档](https://docs.rs/tokio/latest/tokio/sync/struct.Semaphore.html)
- [Rate Limiting 最佳实践](https://cloud.google.com/architecture/rate-limiting-strategies-techniques)
