#!/usr/bin/env node
// One-off: apply Week 5 swaps to draft_data.json.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRAFT_PATH = path.join(ROOT, 'draft_data.json');
const draft = JSON.parse(fs.readFileSync(DRAFT_PATH, 'utf-8'));

// [team_id, out, in, capped, role]
const SWAPS = [
  [9, 'Ayush Mhatre',     'Sakib Hussain',     'Uncapped', 'BOWL'],
  [9, 'Vipraj Nigam',     'Mukesh Choudhary',  'Uncapped', 'BOWL'],
  [8, 'Finn Allen',       'Allah Ghazanfar',   'Capped',   'BOWL'],
  [8, 'Digvesh Rathi',    'Shubham Dubey',     'Uncapped', 'BAT'],
  [5, 'Prashant Veer',    'Eshan Malinga',     'Capped',   'BOWL'],
  [5, 'Shardul Thakur',   'Yash Raj Punja',    'Uncapped', 'BOWL'],
  [3, 'Mitchell Santner', 'Mitchell Starc',    'Capped',   'BOWL'],
  [3, 'Anuj Rawat',       'Finn Allen',        'Capped',   'BAT'],
  [4, 'Onkar Tarmale',    'Spencer Johnson',   'Capped',   'BOWL'],
  [4, 'Harpreet Brar',    'Ashwani Kumar',     'Uncapped', 'BOWL'],
  // Valtheru swap skipped per owner — Gurjapneet Singh not picked up.
  [6, 'Jaydev Unadkat',   'Akeal Hosein',      'Capped',   'AR'],
  [6, 'Avesh Khan',       'Akash Madhwal',     'Uncapped', 'BOWL'],
  [7, 'Lockie Ferguson',  'Praful Hinge',      'Uncapped', 'BOWL'],
  [7, 'Ishant Sharma',    'Rasikh Salam',      'Uncapped', 'BOWL'],
];

const errors = [];
for (const [teamId, outName, inName, capped, role] of SWAPS) {
  const team = draft.teams.find(t => t.id === teamId);
  if (!team) { errors.push(`team ${teamId} not found`); continue; }
  const idx = team.players.indexOf(outName);
  if (idx === -1) { errors.push(`[${team.name}] OUT player not found: ${outName}`); continue; }
  if (team.players.includes(inName)) { errors.push(`[${team.name}] IN player already on team: ${inName}`); continue; }

  team.players[idx] = inName;
  delete team.player_points[outName];
  delete team.player_capped[outName];
  delete team.player_roles[outName];
  team.player_points[inName] = 0;
  team.player_capped[inName] = capped;
  team.player_roles[inName] = role;
  console.log(`✓ [${team.name}] ${outName} → ${inName} (${capped}, ${role})`);
}

if (errors.length) {
  console.error('\n❌ Errors:');
  errors.forEach(e => console.error('  ' + e));
  process.exit(1);
}

// Recompute total_points per team from current player_points
for (const team of draft.teams) {
  team.total_points = Object.values(team.player_points).reduce((a, b) => a + b, 0);
}

fs.writeFileSync(DRAFT_PATH, JSON.stringify(draft, null, 2) + '\n');
console.log(`\n✅ Wrote ${DRAFT_PATH}`);
