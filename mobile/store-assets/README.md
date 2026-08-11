# Store assets — Google Play

Generated promotional assets for the Google Play listing.

| File | Size | Play Console field |
|------|------|--------------------|
| `feature-graphic.png` | 1024×500 | Feature graphic (required) |
| `screenshot-1-browse.png` | 1080×1920 | Phone screenshot — browse teachers |
| `screenshot-2-safety.png` | 1080×1920 | Phone screenshot — parental safety |
| `screenshot-3-earn.png` | 1080×1920 | Phone screenshot — teach & earn |
| `../play-store-icon-512.png` | 512×512 | App icon (required) |

Copy in the listing:
- **App name:** Drushe – ילדים מלמדים ילדים
- **Short description:** פלטפורמת שיעורים פרטיים בין ילדים, בפיקוח הורים מלא ובאישור מנהל
- **Full description:** see `../store-listing.txt`

## Regenerating

`build-store-assets.js` renders the assets with Playwright + embedded Heebo/Rubik
Hebrew fonts. It expects, in the working directory: `icon.b64` (base64 of the
512 icon) and `node_modules/@fontsource/{heebo,rubik}`. Run with a Chromium
executablePath if the pinned Playwright browser build is unavailable.
