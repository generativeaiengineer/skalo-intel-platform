'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');

const DATA_PATH = path.join(__dirname, '..', 'data', 'github-intel.json');

router.get('/', (req, res) => {
  let reports     = [];
  let lastUpdated = null;
  let lastUpdatedFormatted = null;

  try {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    reports     = data.reports || [];
    lastUpdated = data.last_updated || null;
    if (lastUpdated) {
      lastUpdatedFormatted = new Date(lastUpdated).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    }
  } catch (err) {
    console.warn('⚠️  Could not read github-intel.json:', err.message);
  }

  // Collect unique languages for filter pills
  const langSet = new Set();
  reports.forEach(r => (r.repos || []).forEach(repo => {
    if (repo.language) langSet.add(repo.language);
  }));
  const languages = ['All', ...Array.from(langSet).sort()];

  res.render('github', {
    title: 'GitHub Advice',
    activePage: 'github',
    reports,
    lastUpdated: lastUpdatedFormatted,
    languages,
  });
});

module.exports = router;
