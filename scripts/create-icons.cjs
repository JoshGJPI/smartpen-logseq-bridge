// scripts/create-icons.cjs
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const iconSizes = [16, 24, 32, 48, 64, 128, 256, 512];

// SVG design - pen icon with blue gradient
const createSVG = (size) => `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#2563eb;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#1e40af;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size/6.4}" fill="url(#grad)"/>
  <!-- Pen icon -->
  <path d="M${size*0.3},${size*0.7} L${size*0.7},${size*0.3} L${size*0.75},${size*0.35} L${size*0.35},${size*0.75} Z"
        fill="white" opacity="0.9"/>
  ${size >= 256 ? `<circle cx="${size*0.25}" cy="${size*0.75}" r="${size*0.08}" fill="white" opacity="0.7"/>` : ''}
</svg>
`;

const publicPath = path.join(__dirname, '../public');

// Ensure public directory exists
if (!fs.existsSync(publicPath)) {
  fs.mkdirSync(publicPath, { recursive: true });
  console.log('Created public/ directory');
}

console.log('Creating app icons...');

Promise.all(
  iconSizes.map(size => {
    const svg = createSVG(size);
    const filename = size === 512 ? 'icon.png' : `${size}.png`;
    const filepath = path.join(publicPath, filename);

    return sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(filepath)
      .then(() => console.log(`  Created ${size}x${size} PNG`));
  })
).then(() => {
  console.log('\nCreating Windows ICO...');
  const icongen = require('icon-gen');

  return icongen(publicPath, publicPath, {
    type: 'png',
    report: false,
    ico: {
      name: 'icon',
      sizes: [16, 24, 32, 48, 64, 128, 256]
    }
  });
}).then(() => {
  console.log('  Created icon.ico');

  // Clean up intermediate files
  iconSizes.forEach(size => {
    if (size !== 512) {
      const filepath = path.join(publicPath, `${size}.png`);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    }
  });

  console.log('  Cleaned up temporary files');
  console.log('\nIcons ready:');
  console.log('  - public/icon.png (512x512)');
  console.log('  - public/icon.ico (multi-size)\n');
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
