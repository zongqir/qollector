use crate::share::ShareError;
use base64::Engine;
use image::{GrayImage, Luma};
use qrcode::QrCode;

/// Generate a QR code as a base64-encoded PNG data URL.
pub fn generate_qr_base64(content: &str) -> Result<String, ShareError> {
    let code = QrCode::new(content.as_bytes())
        .map_err(|e| ShareError::QrGeneration(e.to_string()))?;

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
