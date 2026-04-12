#!/usr/bin/env node
//
// Usage: node scripts/sync_game.js <gameFile>
//   e.g. node scripts/sync_game.js game3.json
//
// Automates the full fantasy scoring pipeline:
//   1. Parse raw ESPN Cricinfo match JSON
//   2. Calculate fantasy points (batting/bowling/fielding)
//   3. Apply conditional uncapped 2x multiplier
//   4. Generate scoring_gameN.json
//   5. Recompute draft_data.json totals from ALL scoring files
//   6. Rebuild index.html (add tab, inline data, update stats)
//   7. Print summary
//

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NAME_MAP = require('./name_map.json');
const WEEK_CONFIG = require('./week_config.json');

// ─── CLI ────────────────────────────────────────────────────────────
const gameFile = process.argv[2];
if (!gameFile) {
  console.error('Usage: node scripts/sync_game.js <gameFile>');
  process.exit(1);
}
const gamePath = path.resolve(ROOT, gameFile);
if (!fs.existsSync(gamePath)) {
  console.error(`File not found: ${gamePath}`);
  process.exit(1);
}

// ─── Load data ──────────────────────────────────────────────────────
const game = require(gamePath);
const draft = require(path.join(ROOT, 'draft_data.json'));

// ─── Detect game number ─────────────────────────────────────────────
const matchTitle = game.match.title || '';
let gameNum = null;

// Try to extract from match title ("3rd Match" → 3)
const titleMatch = matchTitle.match(/(\d+)/);
if (titleMatch) gameNum = parseInt(titleMatch[1]);

// Fallback: next available scoring file number
if (!gameNum) {
  gameNum = 1;
  while (fs.existsSync(path.join(ROOT, `scoring_game${gameNum}.json`))) gameNum++;
}

const scoringPath = path.join(ROOT, `scoring_game${gameNum}.json`);
console.log(`\n📋 Processing ${gameFile} → scoring_game${gameNum}.json`);

// ─── Look up week and roster from config ────────────────────────────
const weekEntry = WEEK_CONFIG.weeks.find(w => w.games.includes(gameNum));
const gameWeekNum = weekEntry ? weekEntry.week : null;
if (!gameWeekNum) {
  console.error(`❌ Game ${gameNum} is not assigned to any week in scripts/week_config.json`);
  console.error(`   Add it to an existing week or create a new week entry.`);
  process.exit(1);
}
const rosterFile = weekEntry.roster;
const rosterPath = path.join(ROOT, rosterFile);
if (!fs.existsSync(rosterPath)) {
  console.error(`❌ Roster file not found: ${rosterFile}`);
  process.exit(1);
}
const scoringDraft = (rosterFile === 'draft_data.json')
  ? draft
  : JSON.parse(fs.readFileSync(rosterPath, 'utf-8'));
const week1Path = path.join(ROOT, 'draft_data_week1.json');
console.log(`   Week ${gameWeekNum} — using roster: ${rosterFile}`);

// ─── Build lookups from scoring roster (week-appropriate) ──────────
const cappedLookup = {};
const teamLookup = {};
for (const team of scoringDraft.teams) {
  if (!team.player_roles) team.player_roles = {};
  for (const player of team.players) {
    cappedLookup[player] = team.player_capped[player];
    teamLookup[player] = { id: team.id, name: team.name };
  }
}

// ─── Extract player roles from match data ───────────────────────────
function roleLabel(playingRoles) {
  if (!playingRoles || !playingRoles.length) return 'BAT';
  const r = playingRoles[0].toLowerCase();
  if (r.includes('wicketkeeper')) return 'WK';
  if (r.includes('allrounder') || r.includes('all-rounder')) return 'AR';
  if (r.includes('bowler')) return 'BOWL';
  return 'BAT';
}

if (game.content.matchPlayers?.teamPlayers) {
  for (const tp of game.content.matchPlayers.teamPlayers) {
    for (const pl of tp.players) {
      const p = pl.player;
      const name = draftName(p.longName);
      const role = roleLabel(p.playingRoles);
      // Update role in both draft files if this player is drafted
      for (const d of [draft, scoringDraft]) {
        for (const team of d.teams) {
          if (team.players.includes(name) && !team.player_roles[name]) {
            team.player_roles[name] = role;
          }
        }
      }
    }
  }
}

function draftName(gameName) {
  return NAME_MAP[gameName] || gameName;
}

// ─── Parse innings ──────────────────────────────────────────────────
const innings = game.content.innings;
const team1Name = innings[0]?.team?.longName || innings[0]?.team?.name || 'Team 1';
const team2Name = innings[1]?.team?.longName || innings[1]?.team?.name ||
  game.match.teams?.[1]?.team?.longName || game.match.teams?.[1]?.team?.name || 'Team 2';

console.log(`   ${team1Name} vs ${team2Name}`);
console.log(`   ${game.match.statusText || game.match.statusEng}\n`);

// ─── Player score accumulator ───────────────────────────────────────
const playerScores = {};

function getOrCreate(name, iplTeam) {
  const dn = draftName(name);
  if (!playerScores[dn]) {
    playerScores[dn] = {
      ipl_team: iplTeam,
      capped_status: cappedLookup[dn] || 'Unknown',
      batting:  { runs: 0, balls: 0, fours: 0, sixes: 0, is_out: false, points: 0, breakdown: [] },
      bowling:  { overs: 0, wickets: 0, conceded: 0, economy: 0, maidens: 0, points: 0, breakdown: [] },
      fielding: { catches: 0, runouts: 0, runout_direct_hits: 0, stumpings: 0, points: 0, breakdown: [] },
      base_points: 0, multiplier: 1, multiplier_reason: '', total_points: 0
    };
  }
  return playerScores[dn];
}

// ─── Batting ────────────────────────────────────────────────────────
for (const inn of innings) {
  const iplTeam = inn.team?.longName || inn.team?.name;

  for (const bat of inn.inningBatsmen) {
    const name = bat.player?.longName || bat.player?.name;
    if (!name) continue;

    const runs  = bat.runs;
    const balls = bat.balls;

    if (runs === null || runs === undefined) {
      const p = getOrCreate(name, iplTeam);
      if (p.batting.breakdown.length === 0) p.batting.breakdown.push('Did not bat');
      continue;
    }

    const fours = bat.fours || 0;
    const sixes = bat.sixes || 0;
    const isOut = bat.isOut && bat.dismissalType !== 12;
    const sr    = balls > 0 ? (runs / balls) * 100 : 0;

    const p = getOrCreate(name, iplTeam);
    p.batting.runs  = runs;
    p.batting.balls = balls;
    p.batting.fours = fours;
    p.batting.sixes = sixes;
    p.batting.is_out = isOut;

    let pts = 0;
    const bd = [];

    // Runs
    if (runs > 0) { pts += runs; bd.push(`${runs} runs = +${runs}`); }

    // Fours
    if (fours > 0) { pts += fours * 2; bd.push(`${fours} fours = +${fours * 2}`); }

    // Sixes
    if (sixes > 0) { pts += sixes * 4; bd.push(`${sixes} sixes = +${sixes * 4}`); }

    // SR bonus (tiered — best tier only)
    if (balls >= 15) {
      if (sr >= 300)      { pts += 25; bd.push(`SR ${sr.toFixed(1)} >=300 = +25`); }
      else if (sr >= 200) { pts += 15; bd.push(`SR ${sr.toFixed(1)} >=200 = +15`); }
    }

    // Run milestones (cumulative)
    if (runs >= 100) { pts += 10; bd.push('≥100 runs bonus = +10'); }
    if (runs >= 50)  { pts += 5;  bd.push('≥50 runs bonus = +5'); }
    if (runs >= 30)  { pts += 5;  bd.push('≥30 runs bonus = +5'); }

    // Duck
    if (isOut && runs === 0) { pts -= 10; bd.push('Out on 0 = -10'); }

    // SR penalty (tiered — worst tier only)
    if (balls >= 15) {
      if (sr <= 60)       { pts -= 25; bd.push(`SR ${sr.toFixed(1)} <=60 = -25`); }
      else if (sr <= 100) { pts -= 10; bd.push(`SR ${sr.toFixed(1)} <=100 = -10`); }
    }

    p.batting.points = pts;
    p.batting.breakdown = bd;
  }
}

// ─── Bowling ────────────────────────────────────────────────────────
for (const inn of innings) {
  const battingTeam  = inn.team?.longName || inn.team?.name;
  const bowlingTeam  = battingTeam === team1Name ? team2Name : team1Name;

  for (const bowl of inn.inningBowlers) {
    const name = bowl.player?.longName || bowl.player?.name;
    if (!name) continue;

    const overs    = bowl.overs || 0;
    const wickets  = bowl.wickets || 0;
    const conceded = bowl.conceded || 0;
    const economy  = bowl.economy || 0;
    const maidens  = bowl.maidens || 0;

    const p = getOrCreate(name, bowlingTeam);
    p.bowling.overs    = overs;
    p.bowling.wickets  = wickets;
    p.bowling.conceded = conceded;
    p.bowling.economy  = economy;
    p.bowling.maidens  = maidens;

    let pts = 0;
    const bd = [];

    // Wickets
    if (wickets > 0) { pts += wickets * 20; bd.push(`${wickets} wickets = +${wickets * 20}`); }

    // Wicket bonuses
    if (wickets >= 5) { pts += 20; bd.push('5 wickets bonus = +20'); }
    if (wickets >= 3) { pts += 10; bd.push('3 wickets bonus = +10'); }

    // Economy bonus (tiered — best tier only, min 3 overs)
    if (overs >= 3) {
      if (economy <= 3)      { pts += 25; bd.push(`Economy ${economy} <=3 = +25`); }
      else if (economy <= 6) { pts += 15; bd.push(`Economy ${economy} <=6 = +15`); }
    }

    // Economy penalty (tiered — worst tier only, min 2 overs)
    if (overs >= 2) {
      if (economy >= 12)      { pts -= 20; bd.push(`Economy ${economy} >=12 = -20`); }
      else if (economy >= 10) { pts -= 10; bd.push(`Economy ${economy} >=10 = -10`); }
    }

    // Maidens
    if (maidens > 0) { pts += maidens * 10; bd.push(`${maidens} maiden(s) = +${maidens * 10}`); }

    p.bowling.points = pts;
    p.bowling.breakdown = bd;
  }
}

// ─── Fielding ───────────────────────────────────────────────────────
// Dismissal types: 1=caught, 2=bowled, 3=lbw, 4=runout, 5=stumped, 12=not out
for (const inn of innings) {
  const battingTeam  = inn.team?.longName || inn.team?.name;
  const fieldingTeam = battingTeam === team1Name ? team2Name : team1Name;

  for (const w of (inn.inningWickets || [])) {
    const type     = w.dismissalType;
    const fielders = w.dismissalFielders || [];
    const batsman  = w.player?.longName;

    if (type === 1) {
      // Caught
      for (const f of fielders) {
        const fn = f.player?.longName;
        if (!fn) continue;
        const p = getOrCreate(fn, fieldingTeam);
        p.fielding.catches++;
        p.fielding.breakdown.push(`Catch (${batsman}) = +10`);
      }
    } else if (type === 4) {
      // Run out
      const named = fielders.filter(f => f.player?.longName);
      if (named.length === 1) {
        const p = getOrCreate(named[0].player.longName, fieldingTeam);
        p.fielding.runout_direct_hits++;
        p.fielding.breakdown.push(`Run out direct hit (${batsman}) = +10`);
      } else {
        for (const f of named) {
          const p = getOrCreate(f.player.longName, fieldingTeam);
          p.fielding.runouts++;
          p.fielding.breakdown.push(`Run out (${batsman}) = +5`);
        }
      }
    } else if (type === 5) {
      // Stumping
      for (const f of fielders) {
        const fn = f.player?.longName;
        if (!fn) continue;
        const p = getOrCreate(fn, fieldingTeam);
        p.fielding.stumpings++;
        p.fielding.breakdown.push(`Stumping (${batsman}) = +10`);
      }
    }
  }
}

// Calculate fielding points
for (const p of Object.values(playerScores)) {
  let pts = 0;
  pts += p.fielding.catches * 10;
  pts += p.fielding.runouts * 5;
  pts += p.fielding.runout_direct_hits * 10;
  pts += p.fielding.stumpings * 10;

  if (p.fielding.catches >= 5) { pts += 25; p.fielding.breakdown.push('5 catches bonus = +25'); }
  if (p.fielding.catches >= 3) { pts += 10; p.fielding.breakdown.push('3 catches bonus = +10'); }

  p.fielding.points = pts;
}

// ─── Totals & uncapped multiplier ───────────────────────────────────
for (const [name, p] of Object.entries(playerScores)) {
  p.base_points = p.batting.points + p.bowling.points + p.fielding.points;

  if (p.capped_status === 'Uncapped') {
    const r = p.batting.runs;
    const w = p.bowling.wickets;
    const d = p.fielding.catches + p.fielding.runouts + p.fielding.runout_direct_hits + p.fielding.stumpings;

    const reasons = [];
    if (r >= 30) reasons.push(`30+ runs (${r})`);
    if (w >= 3)  reasons.push(`3+ wickets (${w})`);
    if (d >= 3)  reasons.push(`3+ fielding dismissals (${d})`);

    if (reasons.length > 0) {
      p.multiplier = 2;
      p.multiplier_reason = reasons.join(', ');
    } else {
      p.multiplier = 1;
      p.multiplier_reason = `Uncapped but no condition met (${r} runs, ${w} wickets, ${d} dismissals)`;
    }
  }

  p.total_points = p.base_points * p.multiplier;
}

// ─── Fantasy team scores (using week-appropriate roster) ────────────
const fantasyTeamScores = scoringDraft.teams.map(team => {
  let total = 0;
  const players = team.players.map(pn => {
    const ps = playerScores[pn];
    const tp = ps ? ps.total_points : 0;
    total += tp;
    return {
      name: pn,
      played: !!ps,
      capped_status: team.player_capped[pn],
      base_points:   ps ? ps.base_points : 0,
      multiplier:    ps ? ps.multiplier : 1,
      multiplier_reason: ps ? ps.multiplier_reason : '',
      total_points: tp
    };
  });
  return { id: team.id, name: team.name, total_points: total, players };
});

// ─── Write scoring file ────────────────────────────────────────────
const scoring = {
  match: {
    title: matchTitle,
    slug: game.match.slug,
    status: game.match.statusText || game.match.statusEng,
    date: game.match.startDate || game.match.startTime,
    ground: game.match.ground?.name || game.match.ground?.longName || '',
    teams: [team1Name, team2Name]
  },
  scoring_rules: {
    note: 'Uncapped players get 2x multiplier ONLY if: 30+ runs OR 3+ wickets OR 3+ fielding dismissals',
    uncapped_multiplier: 2,
    conditions: [
      '30+ runs', '3+ wickets',
      '3+ fielding dismissals (catches + runouts + direct hits + stumpings)'
    ]
  },
  player_scores: playerScores,
  fantasy_team_scores: fantasyTeamScores
};

fs.writeFileSync(scoringPath, JSON.stringify(scoring, null, 2));
console.log(`✅ scoring_game${gameNum}.json written`);

// ─── Recompute draft_data.json from ALL scoring files ───────────────
// Reset
for (const team of draft.teams) {
  for (const p of team.players) team.player_points[p] = 0;
  team.total_points = 0;
}

// Discover all scoring files
const allScoringFiles = [];
let n = 1;
while (true) {
  const sp = path.join(ROOT, `scoring_game${n}.json`);
  if (!fs.existsSync(sp)) break;
  allScoringFiles.push(require(sp));
  n++;
}

for (const sf of allScoringFiles) {
  for (const ft of sf.fantasy_team_scores) {
    const dt = draft.teams.find(t => t.id === ft.id);
    if (!dt) continue;
    // Credit current roster players their individual points
    for (const pl of ft.players) {
      if (dt.player_points.hasOwnProperty(pl.name)) {
        dt.player_points[pl.name] += pl.total_points;
      }
    }
    // Team total includes ALL players (including swapped-out) — points earned are kept
    dt.total_points += ft.total_points;
  }
}

fs.writeFileSync(path.join(ROOT, 'draft_data.json'), JSON.stringify(draft, null, 2));
console.log(`✅ draft_data.json updated (${allScoringFiles.length} games)`);

// ─── Update index.html ─────────────────────────────────────────────
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');

const varName  = `SCORING${gameNum}`;
const prevVar  = `SCORING${gameNum - 1}`;
const totalGames = allScoringFiles.length;

// Reuse week calculation from earlier
const weekNum = gameWeekNum;
const weekTabId = `week${weekNum}`;
const weekSecId = `sec-week${weekNum}`;

// Update inlined DRAFT
html = html.replace(/^const DRAFT = .+$/m, 'const DRAFT = ' + JSON.stringify(draft) + ';');

// Update inlined frozen week snapshots
for (const wc of WEEK_CONFIG.weeks) {
  if (wc.roster === 'draft_data.json') continue; // current roster, already inlined as DRAFT
  const weekN = wc.week;
  const constName = `DRAFT_WEEK${weekN}`;
  const snapPath = path.join(ROOT, wc.roster);
  if (!fs.existsSync(snapPath)) continue;
  const snapDraft = JSON.parse(fs.readFileSync(snapPath, 'utf-8'));
  if (html.includes(`const ${constName}`)) {
    html = html.replace(new RegExp(`^const ${constName} = .+$`, 'm'), `const ${constName} = ${JSON.stringify(snapDraft)};`);
  } else {
    html = html.replace(/^(const DRAFT = .+)$/m, `$1\nconst ${constName} = ${JSON.stringify(snapDraft)};`);
  }
}

// Add new SCORING constant (if not already present)
if (!html.includes(`const ${varName}`)) {
  const prevLine = new RegExp(`^(const ${prevVar} = .+)$`, 'm');
  html = html.replace(prevLine, `$1\nconst ${varName} = ${JSON.stringify(scoring)};`);
} else {
  html = html.replace(new RegExp(`^const ${varName} = .+$`, 'm'), `const ${varName} = ${JSON.stringify(scoring)};`);
}

// Add week tab button if this is a new week
if (!html.includes(`data-tab="${weekTabId}"`)) {
  // Find the last existing week tab to insert after
  const lastWeekTabRe = /(<button class="tab" data-tab="week\d+">Week \d+<\/button>)\n(\s*<button class="tab" data-tab="teams">)/;
  html = html.replace(lastWeekTabRe,
    `$1\n  <button class="tab" data-tab="${weekTabId}">Week ${weekNum}</button>\n$2`
  );
}

// Add week section div if this is a new week
if (!html.includes(`id="${weekSecId}"`)) {
  // Find the last existing week section to insert after
  const lastWeekSecRe = /(<div class="section" id="sec-week\d+"><\/div>)\n(<div class="section" id="sec-teams">)/;
  html = html.replace(lastWeekSecRe,
    `$1\n<div class="section" id="${weekSecId}"></div>\n$2`
  );
}

// Update variable declarations — add scoringN
const varDeclRe = /let draft, draftWeek1, draftWeek2,([\s\S]*?)playerSkills = \{\};/;
const varDeclMatch = html.match(varDeclRe);
if (varDeclMatch && !varDeclMatch[0].includes(`scoring${gameNum}`)) {
  const old = varDeclMatch[0];
  const updated = old.replace(
    `scoring${gameNum - 1},`,
    `scoring${gameNum - 1}, scoring${gameNum},`
  );
  html = html.replace(old, updated);
}

// Update inline-data branch in init()
// Condition check: add && SCORINGN
if (!html.includes(`&& ${varName}`)) {
  html = html.replace(
    `&& ${prevVar})`,
    `&& ${prevVar} && ${varName})`
  );
}

// Assignment: add scoringN = SCORINGN
if (!html.includes(`scoring${gameNum} = ${varName}`)) {
  html = html.replace(
    `scoring${gameNum - 1} = ${prevVar};`,
    `scoring${gameNum - 1} = ${prevVar};\n    scoring${gameNum} = ${varName};`
  );
}

// Fetch branch: add fetch for new scoring file
if (!html.includes(`scoring_game${gameNum}.json`)) {
  html = html.replace(
    `fetch('scoring_game${gameNum - 1}.json').then(r => r.json())`,
    `fetch('scoring_game${gameNum - 1}.json').then(r => r.json()),\n      fetch('scoring_game${gameNum}.json').then(r => r.json())`
  );
  // Update destructuring
  html = html.replace(
    `s${gameNum - 1}]) => {`,
    `s${gameNum - 1}, s${gameNum}]) => {`
  );
  html = html.replace(
    `scoring${gameNum - 1} = s${gameNum - 1};`,
    `scoring${gameNum - 1} = s${gameNum - 1}; scoring${gameNum} = s${gameNum};`
  );
}

// renderAll: update allScorings array
if (!html.includes(`scoring${gameNum}].filter`)) {
  html = html.replace(
    `scoring${gameNum - 1}].filter`,
    `scoring${gameNum - 1}, scoring${gameNum}].filter`
  );
}

fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log(`✅ index.html updated (${totalGames} games, Week ${weekNum})\n`);

// ─── Summary ────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════');
console.log(`  GAME ${gameNum}: ${team1Name} vs ${team2Name}`);
console.log(`  ${scoring.match.status}`);
console.log('═══════════════════════════════════════════════');

console.log('\n📊 Fantasy Standings (overall):');
const sorted = [...draft.teams].sort((a, b) => b.total_points - a.total_points);
sorted.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}: ${t.total_points} pts`));

console.log('\n🏏 Top 5 Scorers (this game):');
const topPlayers = Object.entries(playerScores)
  .map(([name, p]) => ({ name, ...p }))
  .sort((a, b) => b.total_points - a.total_points);
topPlayers.slice(0, 5).forEach((p, i) =>
  console.log(`  ${i + 1}. ${p.name}: ${p.total_points} pts (base ${p.base_points}${p.multiplier > 1 ? ' x' + p.multiplier : ''}) [${p.capped_status}]`));

const uncapped2x = topPlayers.filter(p => p.multiplier === 2);
if (uncapped2x.length) {
  console.log('\n⚡ Uncapped 2x earned:');
  uncapped2x.forEach(p => console.log(`  ${p.name}: ${p.total_points} pts — ${p.multiplier_reason}`));
} else {
  console.log('\n  No uncapped players earned 2x this game.');
}

// ─── Name mismatch detection with fuzzy matching ───────────────────
// Check against BOTH current and scoring rosters (covers swapped players)
const allDraftNames = new Set();
for (const team of draft.teams) for (const p of team.players) allDraftNames.add(p);
for (const team of scoringDraft.teams) for (const p of team.players) allDraftNames.add(p);
const draftNamesList = [...allDraftNames];

// Fuzzy match: last name must match AND first initial must match
// This avoids false positives from common surnames like "Kumar", "Ahmed", "Singh", "Khan"
function suggestMatch(gameName) {
  const parts = gameName.toLowerCase().split(/\s+/);
  const lastName = parts[parts.length - 1];
  const firstInitial = parts[0][0];
  const candidates = [];
  for (const dn of draftNamesList) {
    const dp = dn.toLowerCase().split(/\s+/);
    const dLast = dp[dp.length - 1];
    const dFirstInitial = dp[0][0];
    // Last name must match AND first initial must match
    if (dLast === lastName && dFirstInitial === firstInitial) {
      candidates.push(dn);
    }
  }
  return candidates;
}

// Collect ALL unmatched game player names
const unmapped = [];
for (const inn of innings) {
  const allNames = [
    ...inn.inningBatsmen.map(b => b.player?.longName),
    ...inn.inningBowlers.map(b => b.player?.longName),
    ...(inn.inningWickets || []).flatMap(w => (w.dismissalFielders || []).map(f => f.player?.longName))
  ].filter(Boolean);

  for (const n of new Set(allNames)) {
    const dn = draftName(n);
    if (!allDraftNames.has(dn) && !unmapped.includes(n)) unmapped.push(n);
  }
}

// Run fuzzy matching on ALL unmatched players first
const likelyMismatches = [];
const trulyUndrafted = [];
for (const n of unmapped) {
  const suggestions = suggestMatch(n);
  if (suggestions.length) {
    likelyMismatches.push({ game: n, suggestions });
  } else {
    trulyUndrafted.push(n);
  }
}

// Show truly undrafted players (no fuzzy match — safe to ignore)
if (trulyUndrafted.length) {
  const undraftedWithPts = trulyUndrafted.map(n => {
    const dn = draftName(n);
    const ps = playerScores[dn];
    return { name: n, pts: ps ? ps.base_points : 0, ipl: ps ? ps.ipl_team : '?' };
  });
  console.log('\n⚠️  Players NOT in any fantasy team (no close name match):');
  undraftedWithPts.forEach(p => console.log(`  ${p.name} (${p.ipl}): ${p.pts} pts`));
}

// Show likely mismatches — these BLOCK the commit
if (likelyMismatches.length) {
  console.log('\n🚨 LIKELY NAME MISMATCHES — these game players fuzzy-match a drafted player:');
  for (const { game, suggestions } of likelyMismatches) {
    const ps = playerScores[draftName(game)];
    const pts = ps ? ps.base_points : 0;
    console.log(`  "${game}" (${pts} pts) → likely: ${suggestions.map(s => `"${s}"`).join(', ')}`);
    console.log(`    Fix: add to scripts/name_map.json: "${game}": "${suggestions[0]}"`);
  }
  console.log('\n  ⛔ Fix name_map.json and re-run before committing!');
  console.log('\n❌ Sync complete but NAME MISMATCHES DETECTED. Do NOT commit until resolved.');
  process.exit(1);
} else {
  console.log('\n✅ Done. No name mismatches. Review changes, then commit & push.');
}
