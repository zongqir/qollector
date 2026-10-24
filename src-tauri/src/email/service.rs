use crate::core::models::ClipboardItem;
use crate::email::config::EmailRelayConfig;
use lettre::message::header::ContentType;
use lettre::message::{Attachment, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use std::path::Path;

pub struct EmailService;

impl EmailService {
    fn build_transport(config: &EmailRelayConfig) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
        let builder = match config.encryption.to_lowercase().as_str() {
            "tls" => {
                if config.allow_insecure_certs {
                    AsyncSmtpTransport::<Tokio1Executor>::relay(&config.smtp_host)
                        .map_err(|e| format!("SMTP relay init error: {}", e))?
                        .port(config.smtp_port)
                        .tls(Tls::Dangerous(
                            TlsParameters::builder(config.smtp_host.clone())
                                .dangerous_accept_invalid_certs(true)
                                .build()
                                .map_err(|e| format!("TLS build error: {}", e))?,
                        ))
                } else {
                    AsyncSmtpTransport::<Tokio1Executor>::relay(&config.smtp_host)
                        .map_err(|e| format!("SMTP relay init error: {}", e))?
                        .port(config.smtp_port)
                }
            }
            "starttls" => {
                if config.allow_insecure_certs {
                    AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.smtp_host)
                        .map_err(|e| format!("SMTP starttls init error: {}", e))?
                        .port(config.smtp_port)
                        .tls(Tls::Dangerous(
                            TlsParameters::builder(config.smtp_host.clone())
                                .dangerous_accept_invalid_certs(true)
                                .build()
                                .map_err(|e| format!("TLS build error: {}", e))?,
                        ))
                } else {
                    AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.smtp_host)
                        .map_err(|e| format!("SMTP starttls init error: {}", e))?
                        .port(config.smtp_port)
                }
            }
            _ => {
                // 明文连接 (内网默认端口 25)
                AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.smtp_host)
                    .port(config.smtp_port)
            }
        };

        let transport = if !config.username.trim().is_empty() && !config.password.trim().is_empty() {
            builder
                .credentials(Credentials::new(
                    config.username.trim().to_string(),
                    config.password.trim().to_string(),
                ))
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

        let default_subject = match item.type_.as_str() {
            "image" => format!("{}图片资产分享_{}", config.subject_prefix, timestamp_str),
            "file" => format!("{}文件资产分享_{}", config.subject_prefix, timestamp_str),
            _ => {
                let snippet = item.content.chars().take(20).collect::<String>().replace(['\r', '\n'], " ");
                format!("{}剪贴板文本_{}: {}", config.subject_prefix, timestamp_str, snippet)
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

        let mut body_content = body_note.unwrap_or_default();
        if !body_content.is_empty() {
            body_content.push_str("\r\n\r\n---\r\n");
        }
        body_content.push_str(&format!(
            "来源: Qollect 剪贴板\r\n类型: {}\r\n发送时间: {}",
            item.type_,
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
        ));

        // 提取附件
        let (attachment_bytes, attachment_filename, content_type) = if item.type_ == "image" {
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
        } else if item.type_ == "text" && item.content.len() > 1000 {
            let filename = format!("qollect_text_{}.txt", timestamp_str);
            (Some(item.content.as_bytes().to_vec()), Some(filename), Some("text/plain; charset=utf-8".to_string()))
        } else {
            (None, None, None)
        };

        if item.type_ == "text" && item.content.len() <= 1000 {
            body_content.push_str("\r\n\r\n正文内容:\r\n");
            body_content.push_str(&item.content);
        }

        let email = if let (Some(bytes), Some(filename), Some(mime_str)) = (attachment_bytes, attachment_filename, content_type) {
            let ct = ContentType::parse(&mime_str)
                .unwrap_or_else(|_| ContentType::parse("application/octet-stream").unwrap());
            let attachment = Attachment::new(filename).body(bytes, ct);
            let multipart = MultiPart::mixed()
                .singlepart(SinglePart::plain(body_content))
                .singlepart(attachment);
            email_builder.multipart(multipart).map_err(|e| format!("构建多部分邮件失败: {}", e))?
        } else {
            email_builder.singlepart(SinglePart::plain(body_content)).map_err(|e| format!("构建邮件失败: {}", e))?
        };

        transport
            .send(email)
            .await
            .map_err(|e| format!("邮件发送失败: {}", e))?;

        let recipients_str = final_recipients.join(", ");
        Ok(recipients_str)
    }
}
