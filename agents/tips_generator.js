'use strict';

/**
 * SKALO Intel — Weekly Tips Generator
 *
 * Picks 3 random knowledge base entries not yet in tips.json,
 * calls Claude to generate practical tips, and appends them.
 *
 * Usage:  npm run generate-tips   (from web/)
 *         node agents/tips_generator.js
 */

const path      = require('path');
const fs        = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const KNOWLEDGE_PATH = path.join(__dirname, '..', 'knowledge', 'anthropic-knowledge.json');
const TIPS_PATH      = path.join(__dirname, '..', 'data', 'tips.json');

// Categories to draw tips from
const TIP_CATEGORIES = new Set(['Prompt Engineering', 'Claude Code', 'API', 'Models']);

async function generateTip(client, page) {
  const prompt = `Based on this Anthropic documentation entry, generate a practical, actionable tip for AI developers.

Documentation:
Title: ${page.title}
Category: ${page.category}
Summary: ${page.summary}
Key concepts: ${(page.key_concepts || []).join(', ')}

Requirements:
- Title: max 10 words, direct and actionable
- Content: 2-3 sentences with concrete advice. Include a short code example if relevant (use backticks).
- Category: use exactly "${page.category}"

Respond ONLY with valid JSON, no markdown, no explanation:
{"title": "...", "content": "...", "category": "..."}`;

  const response = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 400,
    messages:   [{ role: 'user', content: prompt }],
  });

  const text = response.content?.[0]?.text?.trim() || '';
  // Extract JSON even if wrapped
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response: ${text.slice(0, 100)}`);
  return JSON.parse(match[0]);
}

async function main() {
  console.log('💡 SKALO Tips Generator starting...');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY not set in .env');
    process.exit(1);
  }

  // Load knowledge base
  let pages = [];
  try {
    const kb = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'));
    pages = (kb.pages || []).filter(p => TIP_CATEGORIES.has(p.category));
  } catch (err) {
    console.error('❌ Could not read knowledge base:', err.message);
    process.exit(1);
  }

  // Load existing tips — collect URLs already converted
  let tipsData = { tips: [] };
  try {
    tipsData = JSON.parse(fs.readFileSync(TIPS_PATH, 'utf8'));
  } catch {}

  const usedUrls = new Set(
    tipsData.tips
      .filter(t => t.source_url)
      .map(t => t.source_url)
  );

  // Pages not yet turned into tips
  const unused = pages.filter(p => !usedUrls.has(p.url));
  if (unused.length === 0) {
    console.log('ℹ️  All knowledge base entries already have tips. Nothing to generate.');
    process.exit(0);
  }

  // Pick 3 random
  const shuffled = unused.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 3);

  const client = new Anthropic({ apiKey });
  const generated = [];

  for (const page of selected) {
    try {
      process.stdout.write(`   Generating tip for: ${page.title}...`);
      const tip = await generateTip(client, page);
      generated.push({
        id:         `tip_auto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title:      tip.title,
        content:    tip.content,
        category:   tip.category || page.category,
        tags:       page.key_concepts?.slice(0, 4) || [],
        source:     'auto-generated',
        source_url: page.url,
        added_at:   new Date().toISOString(),
      });
      console.log(' ✓');
    } catch (err) {
      console.log(` ✗ (${err.message})`);
    }
  }

  if (generated.length === 0) {
    console.error('❌ No tips generated.');
    process.exit(1);
  }

  tipsData.tips.push(...generated);
  fs.mkdirSync(path.dirname(TIPS_PATH), { recursive: true });
  fs.writeFileSync(TIPS_PATH, JSON.stringify(tipsData, null, 2), 'utf8');

  console.log(`✅ Generated ${generated.length} new tips. Total tips: ${tipsData.tips.length}`);
}

main().catch(err => {
  console.error('❌ Tips generator failed:', err.message);
  process.exit(1);
});
