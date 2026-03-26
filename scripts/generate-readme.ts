import 'dotenv/config';
import { writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchGrokImaginePrompts } from './utils/cms-client.js';
import { generateReadme, SUPPORTED_LANGUAGES } from './utils/markdown-generator.js';
import type { VideoUrlMap } from './utils/markdown-generator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function loadVideoUrls(): VideoUrlMap {
  try {
    const data = JSON.parse(readFileSync(resolve(ROOT, 'video-urls.json'), 'utf-8'));
    return data.prompts || {};
  } catch {
    return {};
  }
}

async function main() {
  const downloadVideosMode = process.env.DOWNLOAD_VIDEOS || 'auto';
  // 'auto' = incremental (download only new), 'true' = force all, 'false' = skip

  // Load existing video/image URL mappings
  let videoUrls: VideoUrlMap = loadVideoUrls();

  // Download media: auto (incremental) or force (all)
  if (downloadVideosMode === 'true' || downloadVideosMode === 'auto') {
    const { prompts } = await fetchGrokImaginePrompts('en');

    // In auto mode, only download for prompts not yet in video-urls.json
    const promptsToProcess = downloadVideosMode === 'auto'
      ? prompts.filter(p => p.videoUrl && !videoUrls[String(p.id)])
      : prompts;

    if (promptsToProcess.length > 0) {
      console.log(`\n🎬 Media download: ${downloadVideosMode} mode — ${promptsToProcess.length} new items to process`);
      const { downloadVideos } = await import('./download-videos.js');
      const videoFiles = await downloadVideos(promptsToProcess);

      if (videoFiles.size > 0) {
        console.log('\n📤 Uploading media to GitHub Release...');
        const { uploadVideos } = await import('./upload-to-github.js');
        videoUrls = await uploadVideos(videoFiles);
      }
    } else {
      console.log('\n✅ No new media to download');
    }
  }

  for (const lang of SUPPORTED_LANGUAGES) {
    console.log(`\n🌐 Processing language: ${lang.name} (${lang.code})...`);

    console.log(`  📥 Fetching Grok Imagine prompts (locale: ${lang.code})...`);
    const { prompts, totalDocs } = await fetchGrokImaginePrompts(lang.code);
    console.log(`  ✅ Got ${prompts.length} prompts with thumbnails (total in CMS: ${totalDocs}, featured: ${prompts.filter(p => p.featured).length})`);

    console.log(`  📝 Generating ${lang.readmeFileName}...`);
    const readme = generateReadme(prompts, lang.code, videoUrls, totalDocs);
    const outPath = resolve(ROOT, lang.readmeFileName);
    writeFileSync(outPath, readme, 'utf-8');
    console.log(`  ✅ ${lang.readmeFileName} written (${(readme.length / 1024).toFixed(1)} KB)`);
  }

  console.log('\n✨ All languages processed successfully!');
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
