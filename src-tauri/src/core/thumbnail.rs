use fast_image_resize as fir;
use fir::IntoImageView;
use image::DynamicImage;

/// Generate a thumbnail that fits within max_size x max_size, preserving aspect ratio.
/// Uses fast_image_resize with SIMD acceleration for lower memory usage and better speed.
pub fn generate_thumbnail(img: &DynamicImage, max_size: u32) -> DynamicImage {
    let (src_w, src_h) = (img.width(), img.height());
    if src_w == 0 || src_h == 0 || (src_w <= max_size && src_h <= max_size) {
        return img.clone();
    }

    let (dst_w, dst_h) = if src_w > src_h {
        let h = (max_size as f64 * src_h as f64 / src_w as f64).round() as u32;
        (max_size, h.max(1))
    } else {
        let w = (max_size as f64 * src_w as f64 / src_h as f64).round() as u32;
        (w.max(1), max_size)
    };

    let pixel_type = match img.pixel_type() {
        Some(pt) => pt,
        None => return img.thumbnail(max_size, max_size),
    };

    let mut dst_image = fir::images::Image::new(dst_w, dst_h, pixel_type);
    let mut resizer = fir::Resizer::new();

    if resizer.resize(img, &mut dst_image, None).is_err() {
        return img.thumbnail(max_size, max_size);
    }

    let buf = dst_image.into_vec();
    match pixel_type {
        fir::PixelType::U8x4 => image::RgbaImage::from_raw(dst_w, dst_h, buf)
            .map(DynamicImage::ImageRgba8)
            .unwrap_or_else(|| img.thumbnail(max_size, max_size)),
        fir::PixelType::U8x3 => image::RgbImage::from_raw(dst_w, dst_h, buf)
            .map(DynamicImage::ImageRgb8)
            .unwrap_or_else(|| img.thumbnail(max_size, max_size)),
        _ => img.thumbnail(max_size, max_size),
    }
}
