import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const REPO = 'YouMind-OpenLab/awesome-grok-imagine-prompts';
const RELEASE_TAG = 'videos';
const VIDEO_URLS_FILE = path.resolve(ROOT, 'video-urls.json');

interface VideoUrlMap {
  [promptId: string]: string;
}

function loadVideoUrls(): VideoUrlMap {
  if (!existsSync(VIDEO_URLS_FILE)) return {};
  try {
    const data = JSON.parse(readFileSync(VIDEO_URLS_FILE, 'utf-8'));
    return data.prompts || data || {};
  } catch {
    return {};
  }
}

function saveVideoUrls(urls: VideoUrlMap): void {
  writeFileSync(VIDEO_URLS_FILE, JSON.stringify({ prompts: urls }, null, 2) + '\n');
}

function ensureRelease(): void {
  try {
    execSync(`gh release view ${RELEASE_TAG} --repo ${REPO}`, { stdio: 'pipe' });
  } catch {
    console.log(`Creating release "${RELEASE_TAG}"...`);
    execSync(
      `gh release create ${RELEASE_TAG} --repo ${REPO} --title "Media Assets" --notes "Auto-managed media files for README embedding" --latest=false`,
      { stdio: 'inherit' }
    );
  }
}

export async function uploadVideos(videoFiles: Map<number, string>): Promise<VideoUrlMap> {
  const urls = loadVideoUrls();
  ensureRelease();

  for (const [id, filePath] of videoFiles) {
    const idStr = String(id);
    if (urls[idStr]) {
      console.log(`  ⏭️ Skip ${id} — already uploaded`);
      continue;
    }

    const assetName = `${id}.mp4`;
    try {
      execSync(`gh release upload ${RELEASE_TAG} "${filePath}#${assetName}" --repo ${REPO} --clobber`, {
        stdio: 'inherit',
      });
      urls[idStr] = `https://github.com/${REPO}/releases/download/${RELEASE_TAG}/${assetName}`;
      console.log(`  ✅ Uploaded ${id} → ${urls[idStr]}`);
    } catch (e) {
      console.error(`  ❌ Failed to upload ${id}:`, e);
    }
  }

  saveVideoUrls(urls);
  return urls;
}
