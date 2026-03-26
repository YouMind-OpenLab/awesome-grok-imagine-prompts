import { mkdirSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import type { ProcessedPrompt } from './utils/cms-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TMP_DIR = resolve(ROOT, 'tmp/videos');

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

async function downloadFile(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ⚠️ Failed to download ${url}: ${res.status}`);
      return false;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const { writeFileSync } = await import('fs');
    writeFileSync(dest, buffer);
    return true;
  } catch (err) {
    console.warn(`  ⚠️ Download error for ${url}:`, err);
    return false;
  }
}

async function downloadWithYtDlp(url: string, dest: string): Promise<boolean> {
  try {
    execSync(`yt-dlp -f "best[ext=mp4]/best" -o "${dest}" "${url}"`, {
      stdio: 'pipe',
      timeout: 120_000,
    });
    return existsSync(dest);
  } catch (err) {
    console.warn(`  ⚠️ yt-dlp failed for ${url}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

function compressVideo(input: string, output: string): boolean {
  try {
    execSync(
      `ffmpeg -y -i "${input}" -vcodec libx264 -crf 28 -preset fast -vf "scale='min(720,iw)':-2" -an -movflags +faststart "${output}"`,
      { stdio: 'pipe', timeout: 300_000 }
    );
    return existsSync(output);
  } catch (err) {
    console.warn(`  ⚠️ ffmpeg compression failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}

function isDirectVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.includes('video.twimg.com');
}

/**
 * Download and compress videos for prompts that have sourceVideos.
 * Videos are saved to tmp/videos/{id}.mp4 (gitignored temp dir).
 * Returns map of prompt ID → local file path for newly downloaded files.
 */
export async function downloadVideos(prompts: ProcessedPrompt[]): Promise<Map<number, string>> {
  ensureDir(TMP_DIR);

  const result = new Map<number, string>();
  const withVideo = prompts.filter(p => p.videoUrl && !p.videoUrl.startsWith('cloudflare:'));
  console.log(`\n🖼️ Processing ${withVideo.length} media files...`);

  for (const p of withVideo) {
    const finalPath = resolve(TMP_DIR, `${p.id}.mp4`);

    // Skip if already exists in tmp (incremental)
    if (existsSync(finalPath)) {
      const stat = statSync(finalPath);
      if (stat.size > 0) {
        console.log(`  ⏭️ ${p.id}: already exists (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
        result.set(p.id, finalPath);
        continue;
      }
    }

    const url = p.videoUrl!;
    const rawPath = resolve(TMP_DIR, `${p.id}_raw.mp4`);

    console.log(`  📥 ${p.id}: ${url.substring(0, 80)}...`);

    let downloaded = false;

    try {
      if (isDirectVideoUrl(url)) {
        downloaded = await downloadFile(url, rawPath);
      } else {
        downloaded = await downloadFile(url, rawPath);
        if (!downloaded) {
          downloaded = await downloadWithYtDlp(url, rawPath);
        }
      }

      if (!downloaded || !existsSync(rawPath)) {
        console.log(`  ❌ ${p.id}: download failed`);
        continue;
      }

      const rawSize = statSync(rawPath).size;
      console.log(`  📦 ${p.id}: raw size ${(rawSize / 1024 / 1024).toFixed(1)}MB`);

      // Always compress for consistency
      console.log(`  🔄 ${p.id}: compressing...`);
      if (compressVideo(rawPath, finalPath)) {
        const compSize = statSync(finalPath).size;
        console.log(`  ✅ ${p.id}: compressed to ${(compSize / 1024 / 1024).toFixed(1)}MB`);
        result.set(p.id, finalPath);
      } else {
        // Fallback: use raw file
        const { copyFileSync } = await import('fs');
        copyFileSync(rawPath, finalPath);
        console.log(`  ✅ ${p.id}: using raw file (${(rawSize / 1024 / 1024).toFixed(1)}MB)`);
        result.set(p.id, finalPath);
      }
    } catch (err) {
      console.error(`  ❌ ${p.id}: unexpected error:`, err);
    }
  }

  console.log(`\n✅ ${result.size} media files downloaded to tmp/videos/`);
  return result;
}
