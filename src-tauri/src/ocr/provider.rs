use super::{OcrError, OcrResult};
use async_trait::async_trait;

/// OCR 提供者抽象接口
///
/// 所有 OCR 实现（本地或云端）都必须实现此 trait
#[async_trait]
pub trait OcrProvider: Send + Sync {
    /// 识别图片中的文字
    ///
    /// # 参数
    /// * `image_path` - 图片文件路径
    ///
    /// # 返回
    /// * `Ok(OcrResult)` - 识别结果，包含文本和元数据
    /// * `Err(OcrError)` - 识别失败
    async fn recognize(&self, image_path: &str) -> Result<OcrResult, OcrError>;

    /// 识别图片字节数据中的文字
    ///
    /// # 参数
    /// * `image_data` - 图片二进制数据
    ///
    /// # 返回
    /// * `Ok(OcrResult)` - 识别结果
    /// * `Err(OcrError)` - 识别失败
    async fn recognize_bytes(&self, image_data: &[u8]) -> Result<OcrResult, OcrError>;

    /// 获取提供者名称
    fn provider_name(&self) -> &str;

    /// 检查提供者是否可用
    async fn is_available(&self) -> bool;
}
