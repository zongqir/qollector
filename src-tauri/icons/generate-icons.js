import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ICON_DIR = __dirname;
const SVG_FILE = path.join(ICON_DIR, 'icon.svg');
const SVG_DISCONNECTED = path.join(ICON_DIR, 'icon-disconnected.svg');

async function generateIcons() {
  console.log('Generating icons from icon.svg...\n');

  const svgBuffer = fs.readFileSync(SVG_FILE);
  const svgDisconnectedBuffer = fs.readFileSync(SVG_DISCONNECTED);

  // PNG sizes
  const pngSizes = [32, 64, 128, 256, 512];

  for (const size of pngSizes) {
    const output = path.join(ICON_DIR, `${size}x${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(output);
    console.log(`Generated: ${size}x${size}.png`);

    // Generate @2x version for 128
    if (size === 128) {
      const output2x = path.join(ICON_DIR, '128x128@2x.png');
      await sharp(svgBuffer)
        .resize(256, 256)
        .png()
        .toFile(output2x);
      console.log(`Generated: 128x128@2x.png`);
    }
  }

  // Main icon.png
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(ICON_DIR, 'icon.png'));
  console.log('Generated: icon.png');

  // ICO file (Windows) - generate multiple sizes and combine
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoBuffers = [];

  for (const size of icoSizes) {
    const buffer = await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toBuffer();
    icoBuffers.push(buffer);
  }

  // For ICO, we'll just use the 256x256 as main icon
  // (proper multi-size ICO requires additional library)
  await sharp(svgBuffer)
    .resize(256, 256)
    .toFile(path.join(ICON_DIR, 'icon.ico'));
  console.log('Generated: icon.ico');

  // Windows Store icons
  const storeIcons = [
    [30, 'Square30x30Logo.png'],
    [44, 'Square44x44Logo.png'],
    [71, 'Square71x71Logo.png'],
    [89, 'Square89x89Logo.png'],
    [107, 'Square107x107Logo.png'],
    [142, 'Square142x142Logo.png'],
    [150, 'Square150x150Logo.png'],
    [284, 'Square284x284Logo.png'],
    [310, 'Square310x310Logo.png'],
    [50, 'StoreLogo.png'],
  ];

  for (const [size, filename] of storeIcons) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(ICON_DIR, filename));
    console.log(`Generated: ${filename}`);
  }

  // macOS ICNS - generate required sizes
  // Note: Actual ICNS creation requires iconutil (macOS only)
  const icnsSizes = [16, 32, 64, 128, 256, 512, 1024];
  const iconsetDir = path.join(ICON_DIR, 'icon.iconset');

  if (!fs.existsSync(iconsetDir)) {
    fs.mkdirSync(iconsetDir);
  }

  const icnsMap = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ];

  for (const [size, filename] of icnsMap) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(iconsetDir, filename));
  }

  console.log('Generated iconset for macOS');

  // Try to create ICNS if on macOS
  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(ICON_DIR, 'icon.icns')}"`, {
      stdio: 'ignore'
    });
    console.log('Generated: icon.icns');
  } catch (e) {
    console.log('Note: iconutil not available (macOS only), skipping ICNS generation');
    // Fallback: just copy the 512x512 as icon.icns placeholder
    fs.copyFileSync(
      path.join(ICON_DIR, '512x512.png'),
      path.join(ICON_DIR, 'icon.icns')
    );
  }

  // Clean up iconset directory
  fs.rmSync(iconsetDir, { recursive: true, force: true });

  // Generate disconnected state icons (for tray)
  console.log('\nGenerating disconnected state icons...');

  const disconnectedSizes = [16, 32, 64, 128, 256];
  for (const size of disconnectedSizes) {
    const output = path.join(ICON_DIR, `icon-disconnected-${size}.png`);
    await sharp(svgDisconnectedBuffer)
      .resize(size, size)
      .png()
      .toFile(output);
    console.log(`Generated: icon-disconnected-${size}.png`);
  }

  console.log('\nAll icons generated successfully!');
}

generateIcons().catch(console.error);
