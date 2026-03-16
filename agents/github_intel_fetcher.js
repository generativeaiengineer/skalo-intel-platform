'use strict';

/**
 * SKALO Intel — GitHub Intel Fetcher Agent
 *
 * 1. Scrapes the @github.awesome Instagram page via Apify
 * 2. Downloads videos for unprocessed posts
 * 3. Extracts audio as MP3 (mono, 16kHz) via fluent-ffmpeg
 * 4. Transcribes audio via OpenAI Whisper (whisper-1)
 * 5. Extracts GitHub repo URLs from transcript + caption
 * 6. Fetches repo metadata + README from GitHub REST API
 * 7. Saves everything to data/github-intel-raw.json
 *
 * First run: backfill up to MAX_BACKFILL posts.
 * Subsequent runs: fetch only posts newer than what's already stored.
 *
 * Usage:  npm run fetch-github   (from project root)
 *         node agents/github_intel_fetcher.js
 */

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const fetch   = require('node-fetch');
const ffmpeg  = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { ApifyClient } = require('apify-client');
const OpenAI          = require('openai');
const Anthropic       = require('@anthropic-ai/sdk');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Point fluent-ffmpeg at the bundled binary
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const RAW_DATA_PATH     = path.join(__dirname, '..', 'data', 'github-intel-raw.json');
const REPORTS_DATA_PATH = path.join(__dirname, '..', 'data', 'github-intel.json');

// ── Config ────────────────────────────────────────────────────
const APIFY_API_TOKEN    = process.env.APIFY_API_TOKEN;
const OPENAI_API_KEY     = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN       = process.env.GITHUB_TOKEN;
const INSTAGRAM_USERNAME = 'github.awesome';
const ACTOR_ID           = 'apify/instagram-post-scraper';
const MAX_BACKFILL       = 5;    // posts to fetch on first run
const MAX_INCREMENTAL    = 5;    // posts to fetch on subsequent runs
const README_EXCERPT_LEN = 2000; // chars to keep from README

// GitHub path segments that are not owner/repo pairs
const GH_NON_REPO_PATHS = new Set([
  'search', 'explore', 'topics', 'trending', 'collections',
  'marketplace', 'sponsors', 'settings', 'notifications',
  'login', 'join', 'about', 'features', 'pricing', 'blog',
  'issues', 'pulls', 'actions', 'projects', 'security',
  'pulse', 'graphs', 'community', 'wiki', 'releases',
  'commit', 'commits', 'compare', 'branches', 'tags',
  'blob', 'tree', 'raw', 'archive', 'network', 'stargazers',
  'watchers', 'forks', 'orgs', 'organizations', 'apps', 'users',
]);

// ── Load existing data ────────────────────────────────────────
function loadExisting() {
  try {
    if (fs.existsSync(RAW_DATA_PATH)) {
      return JSON.parse(fs.readFileSync(RAW_DATA_PATH, 'utf8'));
    }
  } catch (err) {
    console.warn(`⚠️  Could not read existing raw data: ${err.message}`);
  }
  return { last_scraped: null, posts: [] };
}

// ── Map a raw Apify item to our schema ────────────────────────
function mapPost(item) {
  const shortCode = item.shortCode || item.id || '';
  const url       = item.url
    || (shortCode ? `https://www.instagram.com/p/${shortCode}/` : null);

  return {
    id:         shortCode || `ig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    url:        url || null,
    video_url:  item.videoUrl || null,
    caption:    item.caption  || item.alt || null,
    posted_at:  item.timestamp || item.takenAt || null,
    thumbnail:  item.displayUrl || item.thumbnailUrl || null,
    transcript: null,
    processed:  false,
    repos:      [],
  };
}

// ── Scrape via Apify ──────────────────────────────────────────
async function scrapeInstagram(resultsLimit) {
  if (!APIFY_API_TOKEN) {
    throw new Error('APIFY_API_TOKEN not set in .env');
  }

  const client = new ApifyClient({ token: APIFY_API_TOKEN });

  console.log(`   Starting Apify actor "${ACTOR_ID}" (limit: ${resultsLimit})...`);

  let run;
  try {
    run = await client.actor(ACTOR_ID).call({
      username:     [INSTAGRAM_USERNAME],
      resultsLimit: resultsLimit,
    });
  } catch (err) {
    console.warn(`⚠️  Apify actor call failed: ${err.message}`);
    return { posts: [], status: `error: ${err.message}` };
  }

  console.log(`   Actor run finished (ID: ${run.id}). Fetching dataset...`);

  let items = [];
  try {
    const dataset = await client.dataset(run.defaultDatasetId).listItems();
    items = dataset.items || [];
  } catch (err) {
    console.warn(`⚠️  Failed to fetch dataset: ${err.message}`);
    return { posts: [], status: `error: ${err.message}` };
  }

  console.log(`   Instagram: ${items.length} raw items received`);

  const posts = items.map(mapPost).filter(p => p.url);
  return { posts, status: 'ok' };
}

// ── Download video to disk ────────────────────────────────────
async function downloadVideo(url, outputPath) {
  const res = await fetch(url, { timeout: 60000 });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading video`);

  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(outputPath);
    res.body.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);
    res.body.on('error', reject);
  });
}

// ── Extract audio as mono 16kHz MP3 ──────────────────────────
function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioChannels(1)       // mono
      .audioFrequency(16000)  // 16kHz — sufficient for speech
      .audioBitrate('32k')
      .toFormat('mp3')
      .on('end', resolve)
      .on('error', reject)
      .save(audioPath);
  });
}

// ── Process videos: download → extract audio → cleanup ───────
async function processVideos(posts) {
  const videoPosts = posts.filter(p => p.video_url && !p.processed);
  console.log(`\n🎬 Video processing: ${videoPosts.length} video(s) to process`);

  const results = [];  // [{ post, audioPath }]

  for (const post of videoPosts) {
    const safeId    = post.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const videoPath = path.join(os.tmpdir(), `skalo_${safeId}.mp4`);
    const audioPath = path.join(os.tmpdir(), `skalo_${safeId}.mp3`);

    process.stdout.write(`   [${post.id}] Downloading video...`);
    try {
      await downloadVideo(post.video_url, videoPath);
      process.stdout.write(' ✓  Extracting audio...');
    } catch (err) {
      console.log(` ✗  Download failed: ${err.message}`);
      continue;
    }

    try {
      await extractAudio(videoPath, audioPath);
      process.stdout.write(' ✓\n');
    } catch (err) {
      console.log(` ✗  Audio extraction failed: ${err.message}`);
      try { fs.unlinkSync(videoPath); } catch {}
      try { fs.unlinkSync(audioPath); } catch {}
      continue;
    }

    // Delete video — audio is all we need going forward
    try {
      fs.unlinkSync(videoPath);
    } catch (err) {
      console.warn(`   ⚠️  Could not delete video temp file: ${err.message}`);
    }

    results.push({ post, audioPath });
  }

  console.log(`   Audio ready: ${results.length}/${videoPosts.length} extracted`);
  return results;
}

// ── Transcribe a single audio file via Whisper ────────────────
async function transcribeAudio(openai, audioPath) {
  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file:  fs.createReadStream(audioPath),
  });
  return response.text;
}

// ── Transcribe all audio results, update post objects in-place ─
async function transcribePosts(audioResults) {
  if (audioResults.length === 0) return;

  if (!OPENAI_API_KEY) {
    console.warn('⚠️  OPENAI_API_KEY not set — skipping transcription');
    return;
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  console.log(`\n🎙️  Transcribing ${audioResults.length} audio file(s)...`);

  let succeeded = 0;

  for (const { post, audioPath } of audioResults) {
    process.stdout.write(`   [${post.id}] Transcribing...`);
    try {
      const transcript = await transcribeAudio(openai, audioPath);
      post.transcript = transcript;
      post.processed  = true;
      try { fs.unlinkSync(audioPath); } catch {}
      process.stdout.write(` ✓ (${transcript.length} chars)\n`);
      succeeded++;
    } catch (err) {
      console.log(` ✗  Transcription failed: ${err.message}`);
      post.processed = false;
      try { fs.unlinkSync(audioPath); } catch {}
    }
  }

  console.log(`   Transcribed: ${succeeded}/${audioResults.length}`);
}

// ── Extract GitHub owner/repo refs from text ──────────────────
function extractGitHubRepos(transcript, caption) {
  const combined = `${transcript || ''}\n${caption || ''}`;
  const seen     = new Map(); // "owner/repo" → { owner, repo }

  // 1. Direct URLs: github.com/owner/repo (with or without https://)
  const urlRe = /(?:https?:\/\/)?github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/gi;
  let m;
  while ((m = urlRe.exec(combined)) !== null) {
    const owner = m[1];
    const repo  = m[2].replace(/[^a-zA-Z0-9._-]/g, '');
    if (!repo || GH_NON_REPO_PATHS.has(owner.toLowerCase())) continue;
    seen.set(`${owner.toLowerCase()}/${repo.toLowerCase()}`, { owner, repo });
  }

  // 2. Verbal "slash" patterns in transcript only: "owner slash repo"
  //    e.g. "aiming-lab slash AutoResearchClaw"
  const verbalRe = /\b([a-zA-Z][a-zA-Z0-9_-]{1,38})\s+slash\s+([a-zA-Z][a-zA-Z0-9_.-]{1,99})\b/gi;
  while ((m = verbalRe.exec(transcript || '')) !== null) {
    const owner = m[1];
    const repo  = m[2].replace(/[^a-zA-Z0-9._-]/g, '');
    if (!repo || GH_NON_REPO_PATHS.has(owner.toLowerCase())) continue;
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, { owner, repo });
  }

  // 3. Plain "owner/repo" patterns in caption (common in IG captions)
  //    Must be preceded by whitespace or start-of-string to avoid false positives
  const slashRe = /(?:^|\s)([a-zA-Z][a-zA-Z0-9_-]{1,38})\/([a-zA-Z][a-zA-Z0-9_.-]{1,99})(?=\s|$)/gm;
  while ((m = slashRe.exec(caption || '')) !== null) {
    const owner = m[1];
    const repo  = m[2].replace(/[^a-zA-Z0-9._-]/g, '');
    if (!repo || GH_NON_REPO_PATHS.has(owner.toLowerCase())) continue;
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, { owner, repo });
  }

  return Array.from(seen.values());
}

// ── Fetch repo metadata + README from GitHub API ──────────────
async function fetchRepoData(owner, repo) {
  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;

  // Repo metadata
  const repoRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    { headers, timeout: 10000 }
  );

  if (repoRes.status === 404) return null;  // private or doesn't exist
  if (!repoRes.ok) throw new Error(`GitHub API ${repoRes.status} for ${owner}/${repo}`);

  const repoData = await repoRes.json();

  // README (best-effort)
  let readmeExcerpt = null;
  try {
    const readmeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      { headers, timeout: 10000 }
    );
    if (readmeRes.ok) {
      const readmeJson = await readmeRes.json();
      const raw = Buffer.from(readmeJson.content, 'base64').toString('utf8');
      readmeExcerpt = raw.slice(0, README_EXCERPT_LEN);
    }
  } catch {}  // README failure never blocks the rest

  return {
    url:            `https://github.com/${repoData.owner.login}/${repoData.name}`,
    name:           repoData.name,
    owner:          repoData.owner.login,
    description:    repoData.description   || null,
    stars:          repoData.stargazers_count,
    forks:          repoData.forks_count,
    language:       repoData.language      || null,
    topics:         repoData.topics        || [],
    readme_excerpt: readmeExcerpt,
    fetched_at:     new Date().toISOString(),
  };
}

// ── Extract repos from posts and fetch GitHub data ────────────
async function extractAndFetchRepos(posts) {
  // Process any post that is transcribed but doesn't have repos yet
  const targets = posts.filter(p => p.processed && !Array.isArray(p.repos));

  if (targets.length === 0) {
    console.log('\n🔍 GitHub extraction: nothing new to process');
    return;
  }

  console.log(`\n🔍 GitHub repo extraction: ${targets.length} post(s)`);

  for (const post of targets) {
    const refs = extractGitHubRepos(post.transcript, post.caption);

    if (refs.length === 0) {
      console.log(`   [${post.id}] No repos found`);
      post.repos = [];
      continue;
    }

    console.log(`   [${post.id}] ${refs.length} repo(s): ${refs.map(r => `${r.owner}/${r.repo}`).join(', ')}`);

    const repos = [];
    for (const { owner, repo } of refs) {
      process.stdout.write(`     → ${owner}/${repo}...`);
      try {
        const data = await fetchRepoData(owner, repo);
        if (data === null) {
          console.log(' (not found / private)');
        } else {
          repos.push(data);
          console.log(` ✓ ★${data.stars} [${data.language || 'n/a'}]`);
        }
      } catch (err) {
        console.log(` ✗ ${err.message}`);
      }
    }

    post.repos = repos;
  }
}

// ── Load existing reports ─────────────────────────────────────
function loadReports() {
  try {
    if (fs.existsSync(REPORTS_DATA_PATH)) {
      return JSON.parse(fs.readFileSync(REPORTS_DATA_PATH, 'utf8'));
    }
  } catch (err) {
    console.warn(`⚠️  Could not read existing reports: ${err.message}`);
  }
  return { last_updated: null, reports: [] };
}

// ── Build the user prompt for Claude ─────────────────────────
function buildUserPrompt(post) {
  const repoDetails = post.repos.map(r => `
Repo: ${r.owner}/${r.name}
URL: ${r.url}
Stars: ${r.stars} | Forks: ${r.forks} | Language: ${r.language || 'unknown'}
Description: ${r.description || 'none'}
Topics: ${r.topics.length ? r.topics.join(', ') : 'none'}
README excerpt:
${r.readme_excerpt || '(no README)'}
`).join('\n---\n');

  return `Analyze this Instagram post about a GitHub repository and generate a developer intelligence report.

TRANSCRIPT:
${post.transcript || '(no transcript)'}

CAPTION:
${post.caption || '(no caption)'}

GITHUB REPOS FOUND:
${repoDetails}

Respond ONLY with valid JSON matching this exact structure — no markdown, no explanation:
{
  "summary": "2-3 sentence overview of what this post covered",
  "repos": [
    {
      "name": "owner/repo",
      "github_url": "https://github.com/owner/repo",
      "stars": 0,
      "language": "Python",
      "what_it_does": "Clear 1-2 sentence explanation",
      "top_10_functions": [
        "1. Feature name — what it does"
      ],
      "recommendation": "USE",
      "recommendation_reason": "Why you should or shouldn't use this",
      "best_for": "Who this is best suited for"
    }
  ]
}`;
}

// ── Call Claude to generate a single post report ──────────────
async function generateReport(anthropic, post) {
  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 2048,
    system:     'You are a senior developer analyst. You analyze GitHub repositories and provide actionable intelligence for a development team. Be concise, practical, and opinionated.',
    messages:   [{ role: 'user', content: buildUserPrompt(post) }],
  });

  const text  = response.content?.[0]?.text?.trim() || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in Claude response: ${text.slice(0, 100)}`);

  const parsed = JSON.parse(match[0]);

  return {
    id:                   `report_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    instagram_post_id:    post.id,
    instagram_post_url:   post.url,
    posted_at:            post.posted_at,
    thumbnail:            post.thumbnail,
    summary:              parsed.summary  || '',
    repos:                parsed.repos    || [],
    generated_at:         new Date().toISOString(),
  };
}

// ── Generate reports for all posts with repos but no report ───
async function generateReports(posts) {
  if (!ANTHROPIC_API_KEY) {
    console.warn('\n⚠️  ANTHROPIC_API_KEY not set — skipping report generation');
    return;
  }

  const existing      = loadReports();
  const reportedIds   = new Set(existing.reports.map(r => r.instagram_post_id));

  // Posts that have repos data but haven't been reported yet
  const targets = posts.filter(p =>
    p.processed &&
    Array.isArray(p.repos) &&
    p.repos.length > 0 &&
    !reportedIds.has(p.id)
  );

  if (targets.length === 0) {
    console.log('\n📝 Report generation: nothing new to report');
    return;
  }

  console.log(`\n📝 Generating ${targets.length} report(s) via Claude...`);

  const anthropic  = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const newReports = [];

  for (const post of targets) {
    process.stdout.write(`   [${post.id}] Generating report...`);
    try {
      const report = await generateReport(anthropic, post);
      newReports.push(report);
      process.stdout.write(` ✓ (${report.repos.length} repo(s) analysed)\n`);
    } catch (err) {
      console.log(` ✗ ${err.message}`);
    }
  }

  if (newReports.length === 0) return;

  // Append new reports, most recent first
  const updated = {
    last_updated: new Date().toISOString(),
    reports:      [...newReports, ...existing.reports],
  };

  fs.mkdirSync(path.dirname(REPORTS_DATA_PATH), { recursive: true });
  fs.writeFileSync(REPORTS_DATA_PATH, JSON.stringify(updated, null, 2), 'utf8');

  console.log(`   Saved ${newReports.length} new report(s) to data/github-intel.json`);
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('🐙 SKALO GitHub Intel Fetcher starting...');
  console.log(`   ${new Date().toISOString()}`);

  // Env var checks — warn early so unconfigured keys don't crash mid-run
  if (!APIFY_API_TOKEN)   console.warn('⚠️  APIFY_API_TOKEN not set — scraping will be skipped');
  if (!OPENAI_API_KEY)    console.warn('⚠️  OPENAI_API_KEY not set — transcription will be skipped');
  if (!ANTHROPIC_API_KEY) console.warn('⚠️  ANTHROPIC_API_KEY not set — report generation will be skipped');
  if (!GITHUB_TOKEN)      console.log('ℹ️  GITHUB_TOKEN not set — unauthenticated GitHub API (60 req/hr limit)');

  try {
    const existing    = loadExisting();
    const existingIds = new Set(existing.posts.map(p => p.id));
    const isBackfill  = existing.posts.length === 0;

    const limit = isBackfill ? MAX_BACKFILL : MAX_INCREMENTAL;
    console.log(`   Mode: ${isBackfill ? 'backfill' : 'incremental'} | Existing posts: ${existing.posts.length}`);

    // Step 0: scrape Instagram (skip if no API token)
    let newPosts = [];
    if (APIFY_API_TOKEN) {
      const { posts: fetched, status } = await scrapeInstagram(limit);
      if (status !== 'ok') {
        console.warn(`⚠️  Scrape ended with status: ${status}`);
      }
      newPosts = fetched.filter(p => !existingIds.has(p.id));
      console.log(`📊 Fetched: ${fetched.length} | New: ${newPosts.length} | Skipped (already stored): ${fetched.length - newPosts.length}`);
      if (newPosts.length === 0) {
        console.log('ℹ️  No new posts found.');
      }
    } else {
      console.log('ℹ️  Skipping scrape — processing existing posts only.');
    }

    // Step 1: download + extract audio for new video posts
    const audioResults = newPosts.length > 0
      ? await processVideos(newPosts)
      : [];

    // Step 2: transcribe — updates post objects in newPosts in-place
    await transcribePosts(audioResults);

    // Merge: new posts (with transcripts) at top + existing, sorted by date
    const merged = [...newPosts, ...existing.posts].sort((a, b) => {
      const da = a.posted_at ? new Date(a.posted_at) : 0;
      const db = b.posted_at ? new Date(b.posted_at) : 0;
      return db - da;
    });

    // Step 3: extract GitHub repos for all processed-but-no-repos posts in merged
    await extractAndFetchRepos(merged);

    // Step 4: generate Claude reports for posts with repos but no report yet
    await generateReports(merged);

    const output = {
      last_scraped: new Date().toISOString(),
      posts:        merged,
    };

    fs.mkdirSync(path.dirname(RAW_DATA_PATH), { recursive: true });
    fs.writeFileSync(RAW_DATA_PATH, JSON.stringify(output, null, 2), 'utf8');

    console.log(`\n✅ Done: ${merged.length} total posts saved to data/github-intel-raw.json`);
  } catch (err) {
    console.error('\n❌ Fatal error in main pipeline:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
