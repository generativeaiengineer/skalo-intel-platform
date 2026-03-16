'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');

const TOOLS_PATH = path.join(__dirname, '..', 'data', 'tools.json');

router.get('/', (req, res) => {
  let tools = [];
  try {
    const data = JSON.parse(fs.readFileSync(TOOLS_PATH, 'utf8'));
    tools = data.tools || [];
  } catch (err) {
    console.warn('⚠️  Could not read tools.json:', err.message);
  }

  // Build unique category list
  const categories = ['All', ...new Set(tools.map(t => t.category))];

  res.render('tools', {
    title: 'Tools Research',
    activePage: 'tools',
    tools,
    categories,
  });
});

module.exports = router;
