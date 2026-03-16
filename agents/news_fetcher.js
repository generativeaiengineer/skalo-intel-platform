'use strict';

/**
 * SKALO Intel — News Fetcher Agent
 *
 * Pulls AI news from Hacker News (Algolia) and Product Hunt,
 * deduplicates, tags by recency, and saves to web/data/news.json.
 *
 * Usage:  npm run fetch-news   (from web/)
 *         node agents/news_fetcher.js
 */

const path  = require('path');
const fs    = require('fs');
const fetch = require('node-fetch');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DATA_PATH    = path.join(__dirname, '..', 'data', 'news.json');
const MAX_PER_SOURCE = 4;   // 4 from HN + 4 from PH = 8 total
const MAX_ARTICLES   = 200; // cap for the stored JSON

// ── Config ────────────────────────────────────────────────────
const PH_CLIENT_ID     = process.env.PH_CLIENT_ID;
const PH_CLIENT_SECRET = process.env.PH_CLIENT_SECRET;

// We run one broad HN query and take the top MAX_PER_SOURCE results
const HN_QUERY = 'artificial intelligence';

const PH_AI_TOPICS = new Set([
  'artificial intelligence', 'machine learning', 'developer tools',
  'saas', 'productivity', 'automation', 'ai', 'llm', 'chatbot',
]);

// ── Date helpers ───────────────────────────────────────────────
function dateGroup(dateStr) {
  if (!dateStr) return 'earlier';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 86400000)   return 'today';
  if (diff < 604800000)  return 'this_week';
  if (diff < 2592000000) return 'this_month';
  return 'earlier';
}

// ── Hacker News ───────────────────────────────────────────────
async function fetchHackerNews() {
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(HN_QUERY)}&tags=story&hitsPerPage=20`;
  try {
    const res  = await fetch(url, { timeout: 10000 });
    const data = await res.json();

    const seen     = new Set();
    const articles = [];

    for (const hit of (data.hits || [])) {
      if (articles.length >= MAX_PER_SOURCE) break;
      if (!hit.url || !hit.title) continue;
      const key = normalizeUrl(hit.url);
      if (seen.has(key)) continue;
      seen.add(key);

      articles.push({
        id:           `hn_${hit.objectID}`,
        title:        hit.title,
        url:          hit.url,
        source:       'hackernews',
        points:       hit.points || 0,
        created_at:   hit.created_at,
        tagline:      null,
        category:     null,
        num_comments: hit.num_comments || 0,
        date_group:   dateGroup(hit.created_at),
      });
    }

    console.log(`   Hacker News: ${articles.length} articles`);
    return { articles, status: 'ok' };
  } catch (err) {
    console.warn(`⚠️  HN fetch failed: ${err.message}`);
    return { articles: [], status: `error: ${err.message}` };
  }
}

// ── Product Hunt ──────────────────────────────────────────────
async function getPhToken() {
  if (!PH_CLIENT_ID || !PH_CLIENT_SECRET) {
    throw new Error('PH_CLIENT_ID / PH_CLIENT_SECRET not set in .env');
  }
  const res = await fetch('https://api.producthunt.com/v2/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     PH_CLIENT_ID,
      client_secret: PH_CLIENT_SECRET,
      grant_type:    'client_credentials',
    }),
    timeout: 10000,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`PH token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function fetchProductHunt() {
  let token;
  try {
    token = await getPhToken();
  } catch (err) {
    console.warn(`⚠️  Product Hunt auth skipped: ${err.message}`);
    return { articles: [], status: `error: ${err.message}` };
  }

  const query = `{
    posts(order: NEWEST, first: 20) {
      edges {
        node {
          id name tagline votesCount url website createdAt
          topics { edges { node { name } } }
        }
      }
    }
  }`;

  try {
    const res  = await fetch('https://api.producthunt.com/v2/api/graphql', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query }),
      timeout: 10000,
    });
    const data = await res.json();
    const edges = data?.data?.posts?.edges || [];

    const articles = [];
    for (const { node } of edges) {
      if (articles.length >= MAX_PER_SOURCE) break;
      const topics = (node.topics?.edges || []).map(e => e.node.name.toLowerCase());
      const isAI   = topics.some(t => PH_AI_TOPICS.has(t));
      if (!isAI) continue;

      articles.push({
        id:         `ph_${node.id}`,
        title:      node.name,
        url:        node.url || node.website,
        source:     'producthunt',
        points:     node.votesCount || 0,
        created_at: node.createdAt,
        tagline:    node.tagline || null,
        category:   null,
        date_group: dateGroup(node.createdAt),
      });
    }

    console.log(`   Product Hunt: ${articles.length} articles`);
    return { articles, status: 'ok' };
  } catch (err) {
    console.warn(`⚠️  Product Hunt fetch failed: ${err.message}`);
    return { articles: [], status: `error: ${err.message}` };
  }
}

// ── Dedup helpers ─────────────────────────────────────────────
function normalizeUrl(url) {
  try {
    const u = new URL(url.toLowerCase().replace(/\/$/, ''));
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ref'].forEach(p => u.searchParams.delete(p));
    return u.origin + u.pathname + u.search;
  } catch {
    return url.toLowerCase().replace(/\/$/, '');
  }
}

function dedup(articles) {
  const seen = new Set();
  return articles.filter(a => {
    const key = normalizeUrl(a.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('📡 SKALO News Fetcher starting...');

  const [hnResult, phResult] = await Promise.all([
    fetchHackerNews(),
    fetchProductHunt(),
  ]);

  const rawCount = hnResult.articles.length + phResult.articles.length;
  const merged   = dedup([...hnResult.articles, ...phResult.articles])
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, MAX_ARTICLES);

  const dedupedRemoved = rawCount - merged.length;
  console.log(`📊 HN: ${hnResult.articles.length} | PH: ${phResult.articles.length} | Deduped: ${dedupedRemoved} removed | Total: ${merged.length}`);

  const output = {
    last_updated: new Date().toISOString(),
    last_fetch_status: {
      hackernews:  hnResult.status,
      producthunt: phResult.status,
    },
    articles: merged,
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2), 'utf8');

  console.log(`✅ News fetched: ${merged.length} articles saved to data/news.json`);
}

main().catch(err => {
  console.error('❌ News fetcher failed:', err.message);
  process.exit(1);
});
