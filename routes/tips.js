'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');

const TIPS_PATH      = path.join(__dirname, '..', 'data', 'tips.json');
const KNOWLEDGE_PATH = path.join(__dirname, '..', 'knowledge', 'anthropic-knowledge.json');

const KB_CATEGORIES = new Set(['Prompt Engineering', 'Claude Code']);

router.get('/', (req, res) => {
  let manualTips = [];
  try {
    const data = JSON.parse(fs.readFileSync(TIPS_PATH, 'utf8'));
    manualTips = data.tips || [];
  } catch (err) {
    console.warn('⚠️  Could not read tips.json:', err.message);
  }

  let kbTips = [];
  try {
    const kb = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'));
    kbTips = (kb.pages || [])
      .filter(p => KB_CATEGORIES.has(p.category))
      .map(p => ({
        id:       `kb_${Buffer.from(p.url).toString('base64').slice(0, 12)}`,
        title:    p.title,
        content:  p.summary,
        category: p.category,
        tags:     p.key_concepts || [],
        source:   'knowledge_base',
        url:      p.url,
        added_at: null,
      }));
  } catch (err) {
    console.warn('⚠️  Could not read knowledge base:', err.message);
  }

  const allTips    = [...manualTips, ...kbTips];
  const categories = ['All', ...new Set(allTips.map(t => t.category))];

  res.render('tips', {
    title: 'Tips & Tricks',
    activePage: 'tips',
    tips: allTips,
    categories,
    kbCount: kbTips.length,
  });
});

module.exports = router;
