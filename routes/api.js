'use strict';

const express              = require('express');
const router               = express.Router();
const path                 = require('path');
const fs                   = require('fs');
const { execSync }         = require('child_process');

const DATA_DIR         = path.join(__dirname, '..', 'data');
const FETCHER          = path.join(__dirname, '..', 'agents', 'news_fetcher.js');
const GITHUB_FETCHER   = path.join(__dirname, '..', 'agents', 'github_intel_fetcher.js');

// GET /api/news
router.get('/news', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'news.json'), 'utf8'));
    res.json(data);
  } catch {
    res.json({ last_updated: null, articles: [] });
  }
});

// GET /api/health
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// POST /api/tools/add
router.post('/tools/add', (req, res) => {
  const { name, tagline, url, category, tags, notes } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: 'name and url are required' });
  }

  const TOOLS_PATH = path.join(DATA_DIR, 'tools.json');
  let data = { tools: [] };
  try {
    data = JSON.parse(fs.readFileSync(TOOLS_PATH, 'utf8'));
  } catch {}

  const newTool = {
    id:       `tool_${Date.now()}`,
    name:     name.trim(),
    tagline:  (tagline || '').trim(),
    url:      url.trim(),
    category: (category || 'Other').trim(),
    tags:     Array.isArray(tags) ? tags : (tags || '').split(',').map(t => t.trim()).filter(Boolean),
    rating:   null,
    notes:    (notes || '').trim(),
    added_at: new Date().toISOString(),
  };

  data.tools.push(newTool);
  fs.writeFileSync(TOOLS_PATH, JSON.stringify(data, null, 2), 'utf8');
  res.json({ success: true, tool: newTool });
});

// POST /api/tips/add
router.post('/tips/add', (req, res) => {
  const { title, content, category, tags } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }

  const TIPS_PATH = path.join(DATA_DIR, 'tips.json');
  let data = { tips: [] };
  try {
    data = JSON.parse(fs.readFileSync(TIPS_PATH, 'utf8'));
  } catch {}

  const newTip = {
    id:       `tip_${Date.now()}`,
    title:    title.trim(),
    content:  content.trim(),
    category: (category || 'General').trim(),
    tags:     Array.isArray(tags) ? tags : (tags || '').split(',').map(t => t.trim()).filter(Boolean),
    source:   'manual',
    added_at: new Date().toISOString(),
  };

  data.tips.push(newTip);
  fs.writeFileSync(TIPS_PATH, JSON.stringify(data, null, 2), 'utf8');
  res.json({ success: true, tip: newTip });
});

// POST /api/refresh-news — trigger news fetcher on demand
router.post('/refresh-news', (req, res) => {
  try {
    execSync(`node "${FETCHER}"`, {
      cwd:     path.join(__dirname, '..'),
      timeout: 45000,
      stdio:   'pipe',
    });
    res.json({ success: true, message: 'News refreshed' });
  } catch (err) {
    console.error('❌ refresh-news error:', err.message);
    res.json({ success: false, message: err.message });
  }
});

// GET /api/github-intel
router.get('/github-intel', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'github-intel.json'), 'utf8'));
    res.json(data);
  } catch {
    res.json({ last_updated: null, reports: [] });
  }
});

// POST /api/refresh-github — trigger GitHub intel fetcher on demand
router.post('/refresh-github', (req, res) => {
  try {
    execSync(`node "${GITHUB_FETCHER}"`, {
      cwd:     path.join(__dirname, '..'),
      timeout: 300000,
      stdio:   'pipe',
    });
    res.json({ success: true, message: 'GitHub intel refreshed' });
  } catch (err) {
    console.error('❌ refresh-github error:', err.message);
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
