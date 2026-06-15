import sharp from 'sharp';
import { statSync, existsSync, unlinkSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

// Every upload is normalized to WebP: EXIF-rotated, capped at MAX_DIM, plus a
// small thumbnail in uploads/thumbs/ so grids never load multi-MB originals.
// If sharp can't decode a file (corrupt/exotic), the original is kept as-is —
// the thumb route falls back to the full file when no thumbnail exists.

const MAX_DIM = 2000;
const THUMB_DIM = 480;

// WebP encode settings. effort 5 = noticeably smaller files than the default 4
// at the same quality (slower encode, fine for occasional uploads);
// smartSubsample keeps edges/text crisp. q82 is a great quality/size sweet
// spot for photos; thumbnails can go lower since they're only ever shown small.
// sharp drops EXIF/metadata by default, so GPS/camera data is stripped too.
const WEBP_FULL = { quality: 82, effort: 5, smartSubsample: true };
const WEBP_THUMB = { quality: 70, effort: 5, smartSubsample: true };

const MIME_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/heic': '.heic', 'image/avif': '.avif',
};

export function thumbName(filename) {
  return filename.replace(/\.[^.]+$/, '') + '.webp';
}

export function thumbFile(uploadDir, filename) {
  return join(uploadDir, 'thumbs', thumbName(filename));
}

/**
 * Convert a freshly-uploaded file (multer saves it with a .orig suffix) to an
 * optimized WebP + thumbnail. Returns { filename, mime, size } for the DB row.
 */
export async function optimizeUpload(srcPath, uploadDir, originalMime) {
  const base = basename(srcPath).replace(/\.orig$/, '');
  const outName = `${base}.webp`;
  const outPath = join(uploadDir, outName);
  try {
    // animated: true preserves GIF/WebP animations in the WebP output
    await sharp(srcPath, { animated: true, failOn: 'none' })
      .rotate()
      .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .webp(WEBP_FULL)
      .toFile(outPath);
    await sharp(srcPath, { failOn: 'none' })
      .rotate()
      .resize({ width: THUMB_DIM, height: THUMB_DIM, fit: 'inside', withoutEnlargement: true })
      .webp(WEBP_THUMB)
      .toFile(thumbFile(uploadDir, outName));
    unlinkSync(srcPath);
    return { filename: outName, mime: 'image/webp', size: statSync(outPath).size };
  } catch {
    // keep the original untouched under a proper extension
    const ext = MIME_EXT[originalMime] || extname(srcPath).replace('.orig', '') || '.jpg';
    const keepName = `${base}${ext}`;
    const keepPath = join(uploadDir, keepName);
    try {
      const { renameSync } = await import('node:fs');
      renameSync(srcPath, keepPath);
    } catch {
      return { filename: basename(srcPath), mime: originalMime, size: statSync(srcPath).size };
    }
    return { filename: keepName, mime: originalMime, size: statSync(keepPath).size };
  }
}

/**
 * Backfill thumbnails for photos uploaded before this pipeline existed.
 * Runs in the background after boot; failures are skipped silently.
 */
export async function backfillThumbnails(filenames, uploadDir) {
  let made = 0;
  for (const filename of filenames) {
    const src = join(uploadDir, filename);
    const dest = thumbFile(uploadDir, filename);
    if (!existsSync(src) || existsSync(dest)) continue;
    try {
      await sharp(src, { failOn: 'none' })
        .rotate()
        .resize({ width: THUMB_DIM, height: THUMB_DIM, fit: 'inside', withoutEnlargement: true })
        .webp(WEBP_THUMB)
        .toFile(dest);
      made++;
    } catch {
      // undecodable file — the thumb route will fall back to the original
    }
  }
  if (made > 0) console.log(`Generated ${made} missing thumbnail(s)`);
}
