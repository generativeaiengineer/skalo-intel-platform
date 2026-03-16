'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');

const DATA_PATH = path.join(__dirname, '..', 'data', 'news.json');

// ── Helpers ───────────────────────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60)     return `${diff}s ago`;
  if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return 'yesterday';
  return `${Math.floor(diff / 86400)}d ago`;
}

function dateGroup(dateStr) {
  if (!dateStr) return 'earlier';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 86400000)   return 'today';
  if (diff < 604800000)  return 'this_week';
  if (diff < 2592000000) return 'this_month';
  return 'earlier';
}

// ── Route ─────────────────────────────────────────────────────
router.get('/', (req, res) => {
  let articles    = [];
  let lastUpdated = null;
  let fetchStatus = null;

  try {
    if (fs.existsSync(DATA_PATH)) {
      const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

      articles = (data.articles || []).map(a => ({
        ...a,
        timeAgo:    timeAgo(a.created_at),
        date_group: a.date_group || dateGroup(a.created_at),
      }));

      if (data.last_updated) {
        lastUpdated = new Date(data.last_updated).toLocaleString('en-US', {
          month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
      }

      fetchStatus = data.last_fetch_status || null;
    }
  } catch (err) {
    console.error('Failed to read news.json:', err.message);
  }

  const todayArticles   = articles.filter(a => a.date_group === 'today');
  const weekArticles    = articles.filter(a => a.date_group === 'this_week');
  const earlierArticles = articles.filter(a => a.date_group !== 'today' && a.date_group !== 'this_week');

  res.render('home', {
    title:          'AI News',
    activePage:     'news',
    articles,
    todayArticles,
    weekArticles,
    earlierArticles,
    lastUpdated,
    fetchStatus,
  });
});

module.exports = router;
