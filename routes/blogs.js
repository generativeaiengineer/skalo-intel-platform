'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const fetch   = require('node-fetch');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BLOGS_PATH  = path.join(__dirname, '..', 'data', 'blogs.json');
const YOUTUBE_KEY = process.env.YOUTUBE_API_KEY;

// Resolve a YouTube @handle → real channel ID via the official Channels API.
// This guarantees we always get the right channel regardless of old/cached IDs.
async function resolveChannelId(handle) {
  const url = `https://www.googleapis.com/youtube/v3/channels?key=${YOUTUBE_KEY}&forHandle=${handle}&part=id`;
  const res  = await fetch(url, { timeout: 8000 });
  const data = await res.json();
  return data.items?.[0]?.id || null;
}

async function fetchLatestVideos(channel) {
  if (!YOUTUBE_KEY) return [];

  try {
    // Use direct ID if provided, otherwise resolve from handle
    let channelId = channel.id || null;
    if (!channelId && channel.handle) {
      channelId = await resolveChannelId(channel.handle);
    }
    if (!channelId) {
      console.warn(`⚠️  Could not resolve channel ID for: ${channel.name}`);
      return [];
    }

    const url = `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_KEY}&channelId=${channelId}&part=snippet&order=date&maxResults=5&type=video`;
    const res  = await fetch(url, { timeout: 8000 });
    const data = await res.json();

    if (data.error) {
      console.warn(`⚠️  YouTube API error for ${channel.name}: ${data.error.message}`);
      return [];
    }
    if (!data.items) return [];

    return data.items.map(item => ({
      videoId:      item.id.videoId,
      title:        item.snippet.title,
      thumbnail:    item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      published_at: item.snippet.publishedAt,
      url:          `https://www.youtube.com/watch?v=${item.id.videoId}`,
    }));
  } catch (err) {
    console.warn(`⚠️  YouTube fetch failed for ${channel.name}: ${err.message}`);
    return [];
  }
}

router.get('/', async (req, res) => {
  let channels = [];
  try {
    const data = JSON.parse(fs.readFileSync(BLOGS_PATH, 'utf8'));
    channels = data.channels || [];
  } catch (err) {
    console.warn('⚠️  Could not read blogs.json:', err.message);
  }

  // Fetch latest 5 videos per channel in parallel
  const channelsWithVideos = await Promise.all(
    channels.map(async ch => ({
      ...ch,
      videos: await fetchLatestVideos(ch),
    }))
  );

  const categories = ['All', ...new Set(channels.map(c => c.category))];

  res.render('blogs', {
    title: 'Blogs & YouTube',
    activePage: 'blogs',
    channels: channelsWithVideos,
    categories,
    youtubeEnabled: !!YOUTUBE_KEY,
  });
});

module.exports = router;
