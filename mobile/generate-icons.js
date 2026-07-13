const sharp = require('sharp');
const path = require('path');

const ROOT = __dirname;
const full = path.join(ROOT, 'icon-source.svg');
const fg = path.join(ROOT, 'icon-foreground.svg');

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
    await sharp(full).resize(launcherSize, launcherSize).png().toFile(path.join(dir, 'ic_launcher.png'));
    await sharp(full).resize(launcherSize, launcherSize).png().toFile(path.join(dir, 'ic_launcher_round.png'));
    await sharp(fg).resize(fgSize, fgSize).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
    console.log('android', name, 'done');
  }

  // iOS single 1024x1024 app icon — square, no baked-in corner rounding (iOS masks it itself),
  // fully opaque (no alpha channel; App Store Connect rejects icons with transparency).
  const iosSource = path.join(ROOT, 'icon-source-ios.svg');
  await sharp(iosSource).resize(1024, 1024).flatten({ background: '#0F1A1F' }).png().toFile(
    path.join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')
  );
  console.log('ios AppIcon done');

  // Play Store listing icon (512x512, uploaded separately in Play Console, not part of the app binary)
  await sharp(full).resize(512, 512).png().toFile(path.join(ROOT, 'play-store-icon-512.png'));
  console.log('play store listing icon done');
}

run().catch(e => { console.error(e); process.exit(1); });
