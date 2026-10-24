use crate::core::models::ClipboardItem;
use crate::email::config::EmailRelayConfig;
use lettre::message::header::ContentType;
use lettre::message::{Attachment, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use std::path::Path;

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub struct EmailService;

impl EmailService {
    fn build_transport(config: &EmailRelayConfig) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
        let effective_port = if config.smtp_port > 0 {
            config.smtp_port
        } else {
            match config.encryption.to_lowercase().as_str() {
                "tls" => 465,
                "starttls" => 587,
                _ => 25,
            }
        };

        let builder = match config.encryption.to_lowercase().as_str() {
            "tls" => {
                let tls_params = TlsParameters::builder(config.smtp_host.clone())
                    .dangerous_accept_invalid_certs(config.allow_insecure_certs)
                    .build()
                    .map_err(|e| format!("TLS build error: {}", e))?;
                AsyncSmtpTransport::<Tokio1Executor>::relay(&config.smtp_host)
                    .map_err(|e| format!("SMTP relay init error: {}", e))?
                    .port(effective_port)
                    .tls(Tls::Wrapper(tls_params))
            }
            "starttls" => {
                let tls_params = TlsParameters::builder(config.smtp_host.clone())
                    .dangerous_accept_invalid_certs(config.allow_insecure_certs)
                    .build()
                    .map_err(|e| format!("TLS build error: {}", e))?;
                AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.smtp_host)
                    .map_err(|e| format!("SMTP starttls init error: {}", e))?
                    .port(effective_port)
                    .tls(Tls::Required(tls_params))
            }
            _ => {
                // 明文连接 (内网默认端口 25)
                AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.smtp_host)
                    .port(effective_port)
            }
        };

        let clean_password = config.password.trim().replace(' ', "");
        let clean_username = if !config.username.trim().is_empty() {
            config.username.trim().to_string()
        } else {
            config.from_address.trim().to_string()
        };

        let transport = if !clean_username.is_empty() && !clean_password.is_empty() {
            builder
                .credentials(Credentials::new(clean_username, clean_password))
                .build()
        } else {
            builder.build()
        };

        Ok(transport)
    }

    pub async fn test_connection(
        config: &EmailRelayConfig,
        target_recipient: Option<String>,
    ) -> Result<String, String> {
        config.validate()?;
        let transport = Self::build_transport(config)?;

        let recipient_str = target_recipient
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| config.from_address.clone());

        let from_header = format!("{} <{}>", config.from_name, config.from_address)
            .parse()
            .map_err(|e| format!("发件人邮箱格式无效: {}", e))?;

        let to_header = recipient_str
            .parse()
            .map_err(|e| format!("收件人邮箱格式无效: {}", e))?;

        let subject = format!("{}连通性测试 (Test Connection)", config.subject_prefix);
        let body = format!(
            "恭喜！Qollect 内部邮件中继测试成功。\r\n\r\nSMTP 服务器: {}:{}\r\n发件人: {}\r\n发送时间: {}",
            config.smtp_host,
            config.smtp_port,
            config.from_address,
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
        );

        let email = Message::builder()
            .from(from_header)
            .to(to_header)
            .subject(subject)
            .singlepart(SinglePart::plain(body))
            .map_err(|e| format!("构建测试邮件失败: {}", e))?;

        transport
            .send(email)
            .await
            .map_err(|e| format!("SMTP 发送失败: {}", e))?;

        Ok(format!("测试邮件已成功投递至 {}", recipient_str))
    }

    pub async fn send_item(
        config: &EmailRelayConfig,
        item: &ClipboardItem,
        target_recipients: Vec<String>,
        custom_subject: Option<String>,
        body_note: Option<String>,
    ) -> Result<String, String> {
        config.validate()?;
        let transport = Self::build_transport(config)?;

        // 确定收件人列表：若未显式指定，且勾选了默认发给自己，则以发件人自己为收件人
        let final_recipients = if target_recipients.is_empty() {
            if config.send_to_self_by_default {
                vec![config.from_address.clone()]
            } else if !config.default_recipients.is_empty() {
                config.default_recipients.clone()
            } else {
                vec![config.from_address.clone()]
            }
        } else {
            target_recipients
        };

        if final_recipients.is_empty() {
            return Err("未指定收件人邮箱".into());
        }

        let from_header = format!("{} <{}>", config.from_name, config.from_address)
            .parse()
            .map_err(|e| format!("发件人邮箱格式无效: {}", e))?;

        let timestamp_str = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();

        let text_content = item.content.as_deref().unwrap_or("");

        let default_subject = match item.type_.as_str() {
            "image" => format!("{}收集箱分享 | 图片资产_{}", config.subject_prefix, timestamp_str),
            "file" => format!("{}收集箱分享 | 文件资产_{}", config.subject_prefix, timestamp_str),
            _ => {
                let snippet = text_content.chars().take(25).collect::<String>().replace(['\r', '\n'], " ");
                let trimmed = snippet.trim();
                if trimmed.is_empty() {
                    format!("{}收集箱文字分享_{}", config.subject_prefix, timestamp_str)
                } else {
                    format!("{}收集箱文字分享 | {}", config.subject_prefix, trimmed)
                }
            }
        };

        let subject = custom_subject
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(default_subject);

        let mut email_builder = Message::builder()
            .from(from_header)
            .subject(subject);

        for recipient in &final_recipients {
            let to_header = recipient
                .trim()
                .parse()
                .map_err(|e| format!("收件人邮箱格式无效 ({}): {}", recipient, e))?;
            email_builder = email_builder.to(to_header);
        }

        let share_time = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let timestamp_str = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();

        let type_desc = match item.type_.as_str() {
            "image" => "图片资产 (已内嵌展示并作为附件提供)",
            "file" => "本地文件资产",
            _ => "文本 / 代码资产",
        };

        let mut plain_body = String::new();
        if let Some(ref note) = body_note {
            if !note.trim().is_empty() {
                plain_body.push_str("【分享附言】\r\n");
                plain_body.push_str(note.trim());
                plain_body.push_str("\r\n\r\n----------------------------------------\r\n");
            }
        }
        plain_body.push_str("【Qollect 收集箱内容分享】\r\n");
        plain_body.push_str(&format!("资产类型: {}\r\n", type_desc));
        plain_body.push_str(&format!("分享时间: {}\r\n", share_time));
        if let Some(ref app) = item.source_app {
            if !app.trim().is_empty() {
                plain_body.push_str(&format!("来源应用: {}\r\n", app.trim()));
            }
        }
        if let Some(ref note) = item.user_note {
            if !note.trim().is_empty() {
                plain_body.push_str(&format!("条目备注: {}\r\n", note.trim()));
            }
        }
        if let Some(ref tags) = item.tags {
            if !tags.trim().is_empty() && tags != "[]" {
                plain_body.push_str(&format!("关联标签: {}\r\n", tags.trim()));
            }
        }
        plain_body.push_str("----------------------------------------\r\n");

        // 提取附件
        let (attachment_bytes, attachment_filename, content_type): (
            Option<Vec<u8>>,
            Option<String>,
            Option<String>,
        ) = if item.type_ == "image" {
            if let Some(ref paths_str) = item.image_paths {
                let paths: serde_json::Value =
                    serde_json::from_str(paths_str).map_err(|e| e.to_string())?;
                let original = paths
                    .get("original")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "图片原图路径缺失".to_string())?;
                let bytes = tokio::fs::read(original)
                    .await
                    .map_err(|e| format!("读取图片文件失败: {}", e))?;
                let ext = Path::new(original)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("png")
                    .to_lowercase();
                let mime = match ext.as_str() {
                    "jpg" | "jpeg" => "image/jpeg",
                    "webp" => "image/webp",
                    "gif" => "image/gif",
                    _ => "image/png",
                };
                let filename = format!("qollect_img_{}.{}", timestamp_str, ext);
                (Some(bytes), Some(filename), Some(mime.to_string()))
            } else {
                (None, None, None)
            }
        } else if item.type_ == "file" {
            let paths: Vec<&str> = text_content.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
            if paths.len() == 1 {
                let file_path = Path::new(paths[0]);
                if let Ok(metadata) = tokio::fs::metadata(file_path).await {
                    if metadata.is_file() && metadata.len() <= 20 * 1024 * 1024 {
                        if let Ok(bytes) = tokio::fs::read(file_path).await {
                            let filename = file_path.file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("attachment")
                                .to_string();
                            (Some(bytes), Some(filename), Some("application/octet-stream".to_string()))
                        } else {
                            (None, None, None)
                        }
                    } else {
                        (None, None, None)
                    }
                } else {
                    (None, None, None)
                }
            } else {
                (None, None, None)
            }
        } else if item.type_ != "image" && text_content.len() > 1000 {
            let filename = format!("qollect_text_{}.txt", timestamp_str);
            (Some(text_content.as_bytes().to_vec()), Some(filename), Some("text/plain; charset=utf-8".to_string()))
        } else {
            (None, None, None)
        };

        if item.type_ == "image" {
            plain_body.push_str("[图片内容已内嵌并作为附件提供]\r\n");
            if let Some(ref ocr) = item.ocr_text {
                if !ocr.trim().is_empty() {
                    plain_body.push_str("\r\n【图片识别文本 (OCR)】\r\n");
                    plain_body.push_str(ocr.trim());
                    plain_body.push_str("\r\n");
                }
            }
        } else if item.type_ == "file" && !text_content.is_empty() {
            plain_body.push_str("\r\n【包含文件列表】\r\n");
            plain_body.push_str(text_content);
            plain_body.push_str("\r\n");
        } else if item.type_ != "image" && item.type_ != "file" {
            if text_content.len() <= 1000 && !text_content.is_empty() {
                plain_body.push_str("\r\n【正文内容】\r\n");
                plain_body.push_str(text_content);
                plain_body.push_str("\r\n");
            } else if text_content.len() > 1000 {
                plain_body.push_str("\r\n【正文摘要 (完整长文本已打包为附件 .txt)】\r\n");
                let snippet: String = text_content.chars().take(400).collect();
                plain_body.push_str(&snippet);
                plain_body.push_str("\r\n...\r\n");
            }
        }

        // 构建美观 HTML 正文
        let mut html_body = String::from(r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 20px; }
.card { max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0,0,0,0.06); overflow: hidden; }
.header { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff; padding: 18px 24px; }
.header h2 { margin: 0; font-size: 18px; font-weight: 600; }
.header p { margin: 4px 0 0 0; font-size: 12px; opacity: 0.9; }
.note-box { margin: 16px 24px 0 24px; background: #eff6ff; border: 1px solid #bfdbfe; border-left: 4px solid #3b82f6; border-radius: 6px; padding: 12px 16px; font-size: 13px; color: #1e40af; line-height: 1.5; }
.meta { padding: 14px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 13px; line-height: 1.6; color: #475569; margin-top: 14px; }
.meta-row { display: flex; margin-bottom: 4px; }
.meta-label { font-weight: 600; width: 75px; color: #334155; flex-shrink: 0; }
.content { padding: 20px 24px; }
.img-container { text-align: center; margin: 8px 0; }
.img-container img { max-width: 100%; height: auto; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
.ocr-box { margin-top: 18px; background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #3b82f6; border-radius: 6px; padding: 14px 18px; }
.ocr-title { font-size: 13px; font-weight: 600; color: #2563eb; margin-bottom: 8px; }
.ocr-content { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; color: #1e293b; }
.text-content { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; background: #f8fafc; padding: 16px; border-radius: 6px; border: 1px solid #e2e8f0; }
.footer { padding: 12px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }
</style>
</head>
<body>
<div class="card">
<div class="header">
  <h2>Qollect 收集箱分享</h2>
  <p>来自桌面端 Qollect 剪贴板管理器的安全分享</p>
</div>
"#);

        if let Some(ref note) = body_note {
            if !note.trim().is_empty() {
                html_body.push_str(&format!(
                    r#"<div class="note-box"><strong>附言：</strong>{}</div>
"#,
                    html_escape(note.trim())
                ));
            }
        }

        html_body.push_str("<div class=\"meta\">\r\n");
        html_body.push_str(&format!(
            r#"  <div class="meta-row"><span class="meta-label">资产类型:</span><span>{}</span></div>
  <div class="meta-row"><span class="meta-label">分享时间:</span><span>{}</span></div>"#,
            html_escape(type_desc),
            html_escape(&share_time)
        ));

        if let Some(ref app) = item.source_app {
            if !app.trim().is_empty() {
                html_body.push_str(&format!(
                    r#"
  <div class="meta-row"><span class="meta-label">来源应用:</span><span>{}</span></div>"#,
                    html_escape(app.trim())
                ));
            }
        }

        if let Some(ref note) = item.user_note {
            if !note.trim().is_empty() {
                html_body.push_str(&format!(
                    r#"
  <div class="meta-row"><span class="meta-label">条目备注:</span><span>{}</span></div>"#,
                    html_escape(note.trim())
                ));
            }
        }

        if let Some(ref tags) = item.tags {
            if !tags.trim().is_empty() && tags != "[]" {
                html_body.push_str(&format!(
                    r#"
  <div class="meta-row"><span class="meta-label">关联标签:</span><span>{}</span></div>"#,
                    html_escape(tags.trim())
                ));
            }
        }

        html_body.push_str("\r\n</div>\r\n<div class=\"content\">\r\n");

        if item.type_ == "image" {
            html_body.push_str(r#"  <div class="img-container">
    <img src="cid:qollect_img_asset" alt="Qollect 剪贴板图片" />
  </div>
"#);
            if let Some(ref ocr) = item.ocr_text {
                if !ocr.trim().is_empty() {
                    html_body.push_str(&format!(
                        r#"  <div class="ocr-box">
    <div class="ocr-title">图片识别文本 (OCR)</div>
    <pre class="ocr-content">{}</pre>
  </div>
"#,
                        html_escape(ocr.trim())
                    ));
                }
            }
        } else if item.type_ == "file" && !text_content.is_empty() {
            html_body.push_str(&format!(
                r#"  <div class="ocr-box">
    <div class="ocr-title">包含文件列表</div>
    <pre class="ocr-content">{}</pre>
  </div>
"#,
                html_escape(text_content)
            ));
        } else if item.type_ != "image" && item.type_ != "file" {
            if text_content.len() <= 1000 && !text_content.is_empty() {
                html_body.push_str(&format!(
                    r#"  <pre class="text-content">{}</pre>
"#,
                    html_escape(text_content)
                ));
            } else if text_content.len() > 1000 {
                let snippet: String = text_content.chars().take(400).collect();
                html_body.push_str(&format!(
                    r#"  <div class="ocr-box">
    <div class="ocr-title">正文摘要 (完整长文本已打包为附件 .txt)</div>
    <pre class="ocr-content">{}
...
</pre>
  </div>
"#,
                    html_escape(&snippet)
                ));
            }
        }

        html_body.push_str(r#"</div>
<div class="footer">
  由 Qollect 剪贴板提供支持
</div>
</div>
</body>
</html>"#);

        let email = if item.type_ == "image" {
            if let (Some(bytes), Some(filename), Some(mime_str)) = (attachment_bytes, attachment_filename, content_type) {
                let ct = ContentType::parse(&mime_str)
                    .unwrap_or_else(|_| ContentType::parse("image/png").unwrap());
                let inline_attachment = Attachment::new_inline_with_name("qollect_img_asset".to_string(), filename)
                    .body(bytes, ct);
                let related = MultiPart::related()
                    .singlepart(SinglePart::html(html_body))
                    .singlepart(inline_attachment);
                let multipart = MultiPart::alternative()
                    .singlepart(SinglePart::plain(plain_body))
                    .multipart(related);
                email_builder.multipart(multipart).map_err(|e| format!("构建邮件失败: {}", e))?
            } else {
                let multipart = MultiPart::alternative()
                    .singlepart(SinglePart::plain(plain_body))
                    .singlepart(SinglePart::html(html_body));
                email_builder.multipart(multipart).map_err(|e| format!("构建邮件失败: {}", e))?
            }
        } else if let (Some(bytes), Some(filename), Some(mime_str)) = (attachment_bytes, attachment_filename, content_type) {
            let ct = ContentType::parse(&mime_str)
                .unwrap_or_else(|_| ContentType::parse("application/octet-stream").unwrap());
            let attachment = Attachment::new(filename).body(bytes, ct);
            let alternative = MultiPart::alternative()
                .singlepart(SinglePart::plain(plain_body))
                .singlepart(SinglePart::html(html_body));
            let multipart = MultiPart::mixed()
                .multipart(alternative)
                .singlepart(attachment);
            email_builder.multipart(multipart).map_err(|e| format!("构建多部分邮件失败: {}", e))?
        } else {
            let multipart = MultiPart::alternative()
                .singlepart(SinglePart::plain(plain_body))
                .singlepart(SinglePart::html(html_body));
            email_builder.multipart(multipart).map_err(|e| format!("构建邮件失败: {}", e))?
        };

        transport
            .send(email)
            .await
            .map_err(|e| format!("邮件发送失败: {}", e))?;

        let recipients_str = final_recipients.join(", ");
        Ok(recipients_str)
    }
}
