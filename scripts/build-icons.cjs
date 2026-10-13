const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { SVGIcons2SVGFontStream } = require('svgicons2svgfont');
const svg2ttf = require('svg2ttf');
const ttf2woff = require('ttf2woff');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_SVG = path.join(ROOT, 'src', 'assets', 'pixel-shrimp-wiggle.svg');
const OUTPUT_DIR = path.join(ROOT, 'media');
const BUILD_DIR = path.join(ROOT, '.icon-build');
const PREPARED_SVG = path.join(BUILD_DIR, 'shrimp.svg');
const FONT_NAME = 'shrimp-check-icons';
const FONT_PATH = path.join(OUTPUT_DIR, `${FONT_NAME}.woff`);
const SHRIMP_CODEPOINT = 0xe001;
const GRID_SIZE = 24;
const CELL_THRESHOLD = 0.2;

async function main() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const sourceSvg = fs.readFileSync(SOURCE_SVG, 'utf8');
  const embeddedPng = extractEmbeddedPng(sourceSvg);
  const png = decodePng(embeddedPng);
  const vectorSvg = rasterToPixelSvg(png, GRID_SIZE);

  fs.writeFileSync(PREPARED_SVG, vectorSvg);

  const svgFont = await createSvgFont(PREPARED_SVG);
  const ttf = svg2ttf(svgFont, {
    copyright: 'Generated from Shrimp Check source assets.',
    description: 'Shrimp Check status bar icon font.'
  });
  const woff = ttf2woff(Buffer.from(ttf.buffer));

  fs.writeFileSync(FONT_PATH, Buffer.from(woff.buffer));
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  console.log(`Wrote ${path.relative(ROOT, FONT_PATH)}`);
}

function extractEmbeddedPng(svg) {
  const match = svg.match(/data:image\/png;base64,([^"]+)/);

  if (!match) {
    throw new Error(`Expected an embedded PNG in ${path.relative(ROOT, SOURCE_SVG)}`);
  }

  return Buffer.from(match[1], 'base64');
}

function decodePng(buffer) {
  const signature = '89504e470d0a1a0a';

  if (buffer.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('Embedded image is not a PNG.');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlaceMethod = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlaceMethod = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  if (bitDepth !== 8 || ![0, 2, 4, 6].includes(colorType)) {
    throw new Error(`Unsupported PNG format: bit depth ${bitDepth}, color type ${colorType}.`);
  }

  if (interlaceMethod !== 0) {
    throw new Error('Interlaced PNG assets are not supported by this icon build script.');
  }

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const stride = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * channels);

  let sourceOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[sourceOffset++];
    const row = inflated.subarray(sourceOffset, sourceOffset + stride);
    sourceOffset += stride;

    const previousRow = y === 0 ? undefined : pixels.subarray((y - 1) * stride, y * stride);
    const currentRow = pixels.subarray(y * stride, (y + 1) * stride);
    unfilterRow(filter, row, previousRow, currentRow, channels);
  }

  return { width, height, channels, pixels };
}

function unfilterRow(filter, source, previous, target, bpp) {
  for (let x = 0; x < source.length; x++) {
    const left = x >= bpp ? target[x - bpp] : 0;
    const up = previous ? previous[x] : 0;
    const upperLeft = previous && x >= bpp ? previous[x - bpp] : 0;

    switch (filter) {
      case 0:
        target[x] = source[x];
        break;
      case 1:
        target[x] = (source[x] + left) & 0xff;
        break;
      case 2:
        target[x] = (source[x] + up) & 0xff;
        break;
      case 3:
        target[x] = (source[x] + Math.floor((left + up) / 2)) & 0xff;
        break;
      case 4:
        target[x] = (source[x] + paeth(left, up, upperLeft)) & 0xff;
        break;
      default:
        throw new Error(`Unsupported PNG filter: ${filter}.`);
    }
  }
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);

  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function rasterToPixelSvg(png, gridSize) {
  const bounds = findForegroundBounds(png);
  const cellWidth = (bounds.maxX - bounds.minX + 1) / gridSize;
  const cellHeight = (bounds.maxY - bounds.minY + 1) / gridSize;
  const rects = [];

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (cellHasForeground(png, bounds, x, y, cellWidth, cellHeight)) {
        rects.push(`M${x} ${y}h1v1H${x}z`);
      }
    }
  }

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">',
    `<path d="${rects.join(' ')}"/>`,
    '</svg>'
  ].join('');
}

function findForegroundBounds(png) {
  const bounds = {
    minX: png.width,
    minY: png.height,
    maxX: -1,
    maxY: -1
  };

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (isForeground(png, x, y)) {
        bounds.minX = Math.min(bounds.minX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxX = Math.max(bounds.maxX, x);
        bounds.maxY = Math.max(bounds.maxY, y);
      }
    }
  }

  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) {
    throw new Error('No foreground pixels found in shrimp asset.');
  }

  return bounds;
}

function cellHasForeground(png, bounds, gridX, gridY, cellWidth, cellHeight) {
  const startX = Math.floor(bounds.minX + gridX * cellWidth);
  const endX = Math.ceil(bounds.minX + (gridX + 1) * cellWidth);
  const startY = Math.floor(bounds.minY + gridY * cellHeight);
  const endY = Math.ceil(bounds.minY + (gridY + 1) * cellHeight);
  let foreground = 0;
  let total = 0;

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      total++;
      if (isForeground(png, x, y)) foreground++;
    }
  }

  return foreground / total >= CELL_THRESHOLD;
}

function isForeground(png, x, y) {
  const index = (y * png.width + x) * png.channels;

  if (png.channels === 1) {
    return png.pixels[index] > 200;
  }

  const red = png.pixels[index];
  const green = png.pixels[index + (png.channels === 2 ? 0 : 1)];
  const blue = png.pixels[index + (png.channels === 2 ? 0 : 2)];
  const alpha =
    png.channels === 2 ? png.pixels[index + 1] : png.channels === 4 ? png.pixels[index + 3] : 255;
  const brightness = (red + green + blue) / 3;

  return alpha > 16 && brightness > 200;
}

function createSvgFont(svgPath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const fontStream = new SVGIcons2SVGFontStream({
      fontName: FONT_NAME,
      fontId: FONT_NAME,
      fontHeight: 1024,
      descent: 0,
      fixedWidth: true,
      centerHorizontally: true,
      centerVertically: true,
      normalize: true,
      log: () => {}
    });

    fontStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    fontStream.on('error', reject);
    fontStream.on('finish', () => resolve(Buffer.concat(chunks).toString('utf8')));

    const glyph = fs.createReadStream(svgPath);
    glyph.metadata = {
      unicode: [String.fromCodePoint(SHRIMP_CODEPOINT)],
      name: 'shrimp'
    };

    fontStream.write(glyph);
    fontStream.end();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
