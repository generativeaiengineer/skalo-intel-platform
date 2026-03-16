'use strict';

const express   = require('express');
const router    = express.Router();
const path      = require('path');
const fs        = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const KNOWLEDGE_PATH = path.join(__dirname, '..', 'knowledge', 'anthropic-knowledge.json');

function buildSystemPrompt() {
  let kb = { pages: [] };
  try {
    kb = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, 'utf8'));
  } catch (err) {
    console.warn('⚠️  Knowledge base not found:', err.message);
  }

  const pagesSummary = (kb.pages || []).map((p, i) =>
    `[${i + 1}] ${p.title} (${p.category})\nURL: ${p.url}\nSummary: ${p.summary}\nKey concepts: ${(p.key_concepts || []).join(', ')}`
  ).join('\n\n');

  return `You are the SKALO AI Coach — an expert guide on Anthropic's Claude, prompt engineering, the Claude API, and Claude Code. You help the SKALO/NEXUS team build smarter AI systems.

You have access to a curated knowledge base of ${kb.pages?.length || 56} Anthropic documentation pages. Use this knowledge to answer questions accurately and reference source URLs when relevant.

KNOWLEDGE BASE:
${pagesSummary}

GUIDELINES:
- Answer in English, even though knowledge base summaries are in Dutch
- Be concise but thorough
- Use code examples when helpful (wrap in triple backticks with language)
- Reference specific knowledge base entries with their URLs when relevant
- If you don't know something, say so honestly
- You are chatting with an AI builder/developer — use technical language freely`;
}

let cachedSystemPrompt = null;

router.get('/', (req, res) => {
  res.render('coach', {
    title: 'AI Coach',
    activePage: 'coach',
  });
});

router.post('/chat', async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured. Add it to your .env file.' });
  }

  if (!cachedSystemPrompt) {
    cachedSystemPrompt = buildSystemPrompt();
  }

  try {
    const client = new Anthropic({ apiKey });

    const messages = [
      ...(history || []).slice(-10).map(h => ({
        role:    h.role,
        content: h.content,
      })),
      { role: 'user', content: message.trim() },
    ];

    const response = await client.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 1024,
      system:     cachedSystemPrompt,
      messages,
    });

    const reply = response.content?.[0]?.text || 'No response generated.';
    res.json({ reply });

  } catch (err) {
    console.error('❌ AI Coach error:', err.message);
    res.status(500).json({ error: 'AI Coach failed: ' + err.message });
  }
});

module.exports = router;
