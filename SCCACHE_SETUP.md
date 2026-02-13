# sccache 安装和配置指南

## 正在安装 sccache...

安装命令已在后台运行：
```bash
cargo install sccache
```

安装时间：约 2-5 分钟

## 安装完成后的配置

### 1. 验证安装

```bash
sccache --version
```

应该显示类似：
```
sccache 0.x.x
```

### 2. 查看统计信息

```bash
sccache --show-stats
```

输出示例：
```
Compile requests                      0
Compile requests executed             0
Cache hits                            0
Cache misses                          0
Cache timeouts                        0
Cache read errors                     0
Forced recaches                       0
Cache write errors                    0
Compilation failures                  0
Cache errors                          0
Non-cacheable compilations            0
Non-cacheable calls                   0
Non-compilation calls                 0
Unsupported compiler calls            0
Average cache write               0.000 s
Average cache read miss           0.000 s
Average cache read hit            0.000 s
Failed distributed compilations       0
```

### 3. 配置已自动添加

`.cargo/config.toml` 已更新：
```toml
[build]
rustc-wrapper = "sccache"  # ← 新增
```

### 4. 测试 sccache

```bash
cd D:\code\pith\src-tauri

# 清理缓存
cargo clean

# 第一次编译（建立缓存）
time cargo build --release

# 查看统计
sccache --show-stats

# 清理构建产物（保留 sccache 缓存）
cargo clean

# 第二次编译（使用缓存）
time cargo build --release

# 再次查看统计（应该看到 cache hits）
sccache --show-stats
```

## 预期效果

### 第一次编译（建立缓存）
```
时间：~40s
Cache hits: 0
Cache misses: ~200
```

### 第二次编译（使用缓存）
```
时间：~8s（提速 80%！）
Cache hits: ~200
Cache misses: 0
```

## 常用命令

```bash
# 查看统计
sccache --show-stats

# 清空缓存
sccache --zero-stats

# 停止 sccache 服务
sccache --stop-server

# 查看缓存位置
sccache --show-stats
```

## 缓存位置

Windows 默认缓存位置：
```
C:\Users\<用户名>\AppData\Local\Mozilla\sccache2
```

可以通过环境变量修改：
```bash
$env:SCCACHE_DIR = "D:\sccache"
```

## 故障排除

### 问题 1: sccache 命令找不到

**解决方案：**
```bash
# 确认安装路径
where sccache

# 如果找不到，添加到 PATH
# Cargo bin 目录通常在：
# C:\Users\<用户名>\.cargo\bin
```

### 问题 2: 缓存不生效

**解决方案：**
```bash
# 停止 sccache 服务
sccache --stop-server

# 清空统计
sccache --zero-stats

# 重新编译
cargo clean
cargo build --release
```

### 问题 3: 磁盘空间不足

**解决方案：**
```bash
# 查看缓存大小
sccache --show-stats

# 清空缓存
rm -rf $env:LOCALAPPDATA\Mozilla\sccache2
```

## 高级配置

### 设置缓存大小限制

```bash
# 设置最大缓存大小为 10GB
$env:SCCACHE_CACHE_SIZE = "10G"
```

### 使用 Redis 作为缓存后端（可选）

```bash
$env:SCCACHE_REDIS = "redis://localhost:6379"
```

### 使用 S3 作为缓存后端（可选）

```bash
$env:SCCACHE_BUCKET = "my-sccache-bucket"
$env:SCCACHE_REGION = "us-east-1"
```

## 与 CI/CD 集成

### GitHub Actions

```yaml
- name: Install sccache
  run: cargo install sccache

- name: Setup sccache
  uses: mozilla-actions/sccache-action@v0.0.3

- name: Build
  run: cargo build --release
  env:
    RUSTC_WRAPPER: sccache
```

### GitLab CI

```yaml
before_script:
  - cargo install sccache
  - export RUSTC_WRAPPER=sccache

build:
  script:
    - cargo build --release
  cache:
    paths:
      - $HOME/.cache/sccache
```

## 总结

sccache 安装完成后：
1. ✅ 自动配置已添加到 `.cargo/config.toml`
2. ✅ 第一次编译会建立缓存（~40s）
3. ✅ 第二次编译使用缓存（~8s，提速 80%）
4. ✅ 适用于所有 Rust 项目

**等待安装完成后，立即生效！** 🚀
