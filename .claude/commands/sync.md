A new game JSON file has been added: $ARGUMENTS

Perform the following steps in order:

## 1. Validate the game file
- Read the game file and confirm it has the expected structure (match info, content.innings, inningBatsmen, inningBowlers, dismissalFielders, etc.)
- Print the match title and result

## 2. Calculate fantasy points
Using the scoring rules from `draft_data.json` → `points_system`:

**Batting:** 1pt/run, +2/four, +4/six, SR>200(min 15b)=+15, SR>300(min 15b)=+25, >30runs=+5, >50runs=+5, >100runs=+10, duck=-10, SR<100(min 15b)=-10, SR<60(min 15b)=-25

**Bowling:** +20/wicket, 3w bonus=+10, 5w bonus=+20, econ<3(min 3ov)=+25, econ<6(min 3ov)=+15, econ>10(min 2ov)=-10, econ>12(min 2ov)=-20, maiden=+10

**Fielding:** catch=+10, 3catches bonus=+10, 5catches bonus=+25, runout(multiple fielders)=+5 each, runout direct hit(single fielder)=+10, stumping=+10

**Name matching:** Handle name mismatches between game files and draft_data.json (e.g., "Varun Chakravarthy" vs "Varun Chakaravarthy"). Check all player names and flag any new mismatches.

**Uncapped conditional 2x rule:** Uncapped players (per `player_capped` in `draft_data.json`) get 2x on ALL their points ONLY if they meet at least one condition in that match:
- 30+ runs scored
- 3+ wickets taken
- 3+ fielding dismissals (catches + runouts + direct hits + stumpings)
If none of these conditions are met, uncapped players earn at 1x (normal rate). Each player entry must include `multiplier_reason` explaining why 2x was or wasn't applied.

## 3. Generate scoring file
- Create `scoring_gameN.json` (determine N from the game file's match title or next available number)
- Include: match info, player_scores (with batting/bowling/fielding breakdowns, base_points, multiplier, total_points), fantasy_team_scores
- Follow the exact same structure as existing `scoring_game1.json` and `scoring_game2.json`

## 4. Update draft_data.json
- Recalculate `player_points` and `total_points` for each team by summing across ALL scoring files (scoring_game1.json, scoring_game2.json, and the new one)
- Do NOT replace — recompute from all games

## 5. Update the UI (index.html)
- Add a new tab for the new game scorecard (e.g., "Game 3 Scorecard")
- Update the inlined data (DRAFT, SCORING1, SCORING2, etc.) to include the new scoring file
- Make sure the stats bar, standings, teams, and MVP leaderboard reflect all games
- The init() function and renderAll() should handle the new game

## 6. Print summary
- Show the fantasy team standings after this game
- Show top 5 scorers from this game
- Show any uncapped players who benefited from 2x
- Flag any players in the game file that are NOT in any fantasy team

## 7. Commit and push
- Stage all changed/new files
- Commit with a descriptive message
- Push to origin main
