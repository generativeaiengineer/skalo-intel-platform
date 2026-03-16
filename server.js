'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const expressLayouts = require('express-ejs-layouts');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Trust proxy (Nginx in front) ─────────────────────────────────────────────
app.set('trust proxy', 1);

// ── View engine ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// ── Static assets ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/',       require('./routes/index'));
app.use('/tools',  require('./routes/tools'));
app.use('/blogs',  require('./routes/blogs'));
app.use('/tips',   require('./routes/tips'));
app.use('/coach',  require('./routes/coach'));
app.use('/github', require('./routes/github'));
app.use('/api',    require('./routes/api'));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', {
    title: '404 — Not Found',
    activePage: '',
    message: 'The page you\'re looking for doesn\'t exist.',
    status: 404,
  });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).render('error', {
    title: 'Server Error',
    activePage: '',
    message: err.message || 'An unexpected error occurred.',
    status: err.status || 500,
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Skalo Intel Platform running on port ${PORT}`);
  console.log(`   http://localhost:${PORT}`);
});

module.exports = app;
