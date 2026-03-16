'use strict';

/**
 * Skalo Intel Platform — Cron Setup Helper
 *
 * This file prints the cron lines to add to your server.
 * Run: node cron.js
 * Then: crontab -e  and paste the output.
 */

console.log('');
console.log('📋  Skalo Intel — Cron Setup');
console.log('═══════════════════════════════════════════════════════════');
console.log('Run:  crontab -e  then paste the following lines:');
console.log('');
console.log('# Fetch AI news every 6 hours');
console.log('0 */6 * * * cd /root/skalo-intel-platform/web && /usr/bin/node agents/news_fetcher.js >> /root/skalo-intel-platform/logs/cron.log 2>&1');
console.log('');
console.log('# Generate new tips every Monday at 9am');
console.log('0 9 * * 1 cd /root/skalo-intel-platform/web && /usr/bin/node agents/tips_generator.js >> /root/skalo-intel-platform/logs/cron.log 2>&1');
console.log('');
console.log('# Fetch GitHub intel daily at 6am');
console.log('0 6 * * * cd /root/skalo-intel-platform/web && npm run fetch-github >> /root/skalo-intel-platform/logs/github-intel.log 2>&1');
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('Verify cron is active: crontab -l');
console.log('Check news/tips logs:  tail -f /root/skalo-intel-platform/logs/cron.log');
console.log('Check github logs:     tail -f /root/skalo-intel-platform/logs/github-intel.log');
console.log('');
