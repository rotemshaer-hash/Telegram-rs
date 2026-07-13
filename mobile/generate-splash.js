const sharp = require('sharp');
const path = require('path');

const ROOT = __dirname;

function splashSvg(w, h) {
  const s = Math.min(w, h) * 0.22;
  const cx = w / 2, cy = h / 2;
  const scale = s / 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0F1A1F"/>
        <stop offset="45%" stop-color="#0e7a72"/>
        <stop offset="1" stop-color="#8b2fc9"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <g transform="translate(${cx},${cy}) scale(${scale}) translate(-12,-12)">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M6 12v5c3 3 9 3 12 0v-5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </svg>`;
}

const androidSplashes = [
  ['drawable-land-xxxhdpi', 1920, 1280], ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxxhdpi', 1280, 1920], ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-land-hdpi', 800, 480], ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-mdpi', 480, 320], ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-port-hdpi', 480, 800], ['drawable', 480, 320], ['drawable-port-mdpi', 320, 480],
];

const iosSplashes = [
  'splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png',
];

async function run() {
  for (const [dir, w, h] of androidSplashes) {
    const svg = Buffer.from(splashSvg(w, h));
    await sharp(svg).resize(w, h).png().toFile(path.join(ROOT, 'android/app/src/main/res', dir, 'splash.png'));
    console.log('android splash', dir, `${w}x${h}`, 'done');
  }
  const svg2732 = Buffer.from(splashSvg(2732, 2732));
  for (const f of iosSplashes) {
    await sharp(svg2732).resize(2732, 2732).png().toFile(path.join(ROOT, 'ios/App/App/Assets.xcassets/Splash.imageset', f));
    console.log('ios splash', f, 'done');
  }
}

run().catch(e => { console.error(e); process.exit(1); });
