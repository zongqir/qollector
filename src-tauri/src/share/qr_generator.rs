use crate::share::ShareError;
use base64::Engine;
use image::{GrayImage, Luma};
use qrcode::bits::Bits;
use qrcode::{EcLevel, QrCode, Version};

const UTF8_ECI_DESIGNATOR: u32 = 26;
const QR_ERROR_CORRECTION_LEVEL: EcLevel = EcLevel::M;

fn build_qr_code(content: &str) -> Result<QrCode, ShareError> {
    let payload = content.as_bytes();

    for version in 1i16..=40i16 {
        let mut bits = Bits::new(Version::Normal(version));

        if bits.push_eci_designator(UTF8_ECI_DESIGNATOR).is_err() {
            continue;
        }
        if bits.push_byte_data(payload).is_err() {
            continue;
        }
        if bits.push_terminator(QR_ERROR_CORRECTION_LEVEL).is_err() {
            continue;
        }

        if let Ok(code) = QrCode::with_bits(bits, QR_ERROR_CORRECTION_LEVEL) {
            return Ok(code);
        }
    }

    // Fallback for unexpected encoding edge cases.
    QrCode::new(payload).map_err(|e| ShareError::QrGeneration(e.to_string()))
}

/// Generate a QR code as a base64-encoded PNG data URL.
pub fn generate_qr_base64(content: &str) -> Result<String, ShareError> {
    let code = build_qr_code(content)?;

    let module_count = code.width() as u32;
    let scale = 8u32;
    let quiet = 4u32;
    let size = (module_count + quiet * 2) * scale;

    let mut img = GrayImage::from_pixel(size, size, Luma([255u8]));

    for y in 0..module_count {
        for x in 0..module_count {
            use qrcode::Color;
            if code[(x as usize, y as usize)] == Color::Dark {
                let px = (x + quiet) * scale;
                let py = (y + quiet) * scale;
                for dy in 0..scale {
                    for dx in 0..scale {
                        img.put_pixel(px + dx, py + dy, Luma([0u8]));
                    }
                }
            }
        }
    }

    let mut png_bytes: Vec<u8> = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png_bytes);
    image::ImageEncoder::write_image(
        encoder,
        img.as_raw(),
        img.width(),
        img.height(),
        image::ExtendedColorType::L8,
    )
    .map_err(|e| ShareError::QrGeneration(e.to_string()))?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

#[cfg(test)]
mod tests {
    use super::generate_qr_base64;

    #[test]
    fn generate_qr_data_url_for_ascii_text() {
        let encoded =
            generate_qr_base64("quick-share-text").expect("should generate qr for ascii text");
        assert!(encoded.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn generate_qr_data_url_for_utf8_text() {
        let encoded = generate_qr_base64("\u{4e2d}\u{6587}\u{6d4b}\u{8bd5}\u{1f680}")
            .expect("should generate qr for utf8 text");
        assert!(encoded.starts_with("data:image/png;base64,"));
    }
}
