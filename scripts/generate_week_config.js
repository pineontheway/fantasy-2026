#!/usr/bin/env node
//
// Usage: node scripts/generate_week_config.js
//
// Reads schedule.json, groups all matches into calendar weeks
// (same formula as index.html), and updates week_config.json.
// Preserves existing manual fields (roster, groups) for each week.
//

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCHEDULE_PATH = path.join(ROOT, 'schedule.json');
const WEEK_CONFIG_PATH = path.join(ROOT, 'scripts', 'week_config.json');

if (!fs.existsSync(SCHEDULE_PATH)) {
  console.error('❌ schedule.json not found in project root');
  process.exit(1);
}

const schedule = JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf-8'));
const matches = schedule.content.matches;

// Same constants as index.html
const WEEK1_START = Date.UTC(2026, 2, 28); // Mar 28, 2026
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function getWeekNumber(dateStr) {
  const d = new Date(dateStr).getTime();
  return Math.floor((d - WEEK1_START) / MS_PER_WEEK) + 1;
}

// Extract game number from title ("29th Match" → 29)
function getGameNum(title) {
  const m = title.match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

// Group matches by week
const weekGames = {};
for (const match of matches) {
  const gameNum = getGameNum(match.title);
  if (!gameNum) continue;
  const weekNum = getWeekNumber(match.startDate);
  if (!weekGames[weekNum]) weekGames[weekNum] = [];
  weekGames[weekNum].push(gameNum);
}

// Sort games within each week
for (const wn of Object.keys(weekGames)) {
  weekGames[wn].sort((a, b) => a - b);
}

// Load existing config to preserve roster/groups
const existing = {};
if (fs.existsSync(WEEK_CONFIG_PATH)) {
  const cfg = JSON.parse(fs.readFileSync(WEEK_CONFIG_PATH, 'utf-8'));
  for (const w of cfg.weeks) {
    existing[w.week] = w;
  }
}

// Merge: auto-generated games + preserved manual fields
const weekNums = Object.keys(weekGames).map(Number).sort((a, b) => a - b);
const weeks = weekNums.map(wn => {
  const entry = { week: wn, games: weekGames[wn] };

  if (existing[wn]) {
    entry.roster = existing[wn].roster;
    if (existing[wn].groups) entry.groups = existing[wn].groups;
  } else {
    entry.roster = 'draft_data.json';
  }

  return entry;
});

const config = { weeks };
fs.writeFileSync(WEEK_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');

console.log('✅ week_config.json updated from schedule.json\n');
console.log('Weeks:');
for (const w of weeks) {
  const start = new Date(WEEK1_START + (w.week - 1) * MS_PER_WEEK);
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
  const fmt = d => d.toISOString().split('T')[0];
  const hasGroups = w.groups ? ` (${w.groups.length} groups)` : '';
  console.log(`  Week ${w.week}: Games ${w.games.join(',')} | ${fmt(start)} to ${fmt(end)} | roster: ${w.roster}${hasGroups}`);
}
