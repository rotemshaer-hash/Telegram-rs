const sharp = require('sharp');
const path = require('path');

const ROOT = __dirname;
const LOGO = '/root/.claude/uploads/ca2a159a-39b3-5ca1-ba6c-86038422fc5c/195ff782-1000201684.png';

const densities = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];

async function run() {
  for (const [name, launcherSize, fgSize] of densities) {
    const dir = path.join(ROOT, 'android/app/src/main/res/mipmap-' + name);
    // Legacy launcher icons: use the logo as-is (it already has its own rounded corners baked in).
    await sharp(LOGO).resize(launcherSize, launcherSize).png().toFile(path.join(dir, 'ic_launcher.png'));
    await sharp(LOGO).resize(launcherSize, launcherSize).png().toFile(path.join(dir, 'ic_launcher_round.png'));
    // Adaptive icon foreground: scale down to ~72% and center on a transparent canvas so
    // Android's own circle/squircle mask doesn't clip the wordmark.
    const inner = Math.round(fgSize * 0.72);
    const logoResized = await sharp(LOGO).resize(inner, inner).toBuffer();
    await sharp({ create: { width: fgSize, height: fgSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: logoResized, gravity: 'center' }])
      .png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
    console.log('android', name, 'done');
  }

  // iOS single 1024x1024 app icon — flatten onto the brand's darkest gradient stop so the
  // logo's own transparent corners resolve to a solid color (iOS forbids alpha in app icons;
  // iOS also applies its own corner rounding, so this stays a plain filled square).
  await sharp(LOGO).resize(1024, 1024).flatten({ background: '#0F1A1F' }).png().toFile(
    path.join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')
  );
  console.log('ios AppIcon done');

  // Play Store listing icon (512x512, uploaded separately in Play Console)
  await sharp(LOGO).resize(512, 512).png().toFile(path.join(ROOT, 'play-store-icon-512.png'));
  console.log('play store listing icon done');
}

run().catch(e => { console.error(e); process.exit(1); });
