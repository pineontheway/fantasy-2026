A new game JSON file has been added: $ARGUMENTS

Run the automated sync script, then review and commit:

## 0. Ensure game is in week config
Before running the sync, check `scripts/week_config.json` to ensure the game number is listed under the correct week. If not, add it. Each week entry maps to a roster file (e.g., `draft_data_week1.json` for Week 1 games).

## 1. Run the sync script
```
node scripts/sync_game.js $ARGUMENTS
```
This handles everything automatically:
- Parses the ESPN Cricinfo game JSON
- Looks up the game's week and roster from `scripts/week_config.json`
- Uses the **correct week's roster** for fantasy team scoring (e.g., Week 1 games use `draft_data_week1.json`)
- Calculates all fantasy points (batting/bowling/fielding)
- Applies conditional uncapped 2x multiplier
- Generates `scoring_gameN.json`
- Extracts player roles from match data
- Recomputes `draft_data.json` from all scoring files
- Updates `index.html` (week tab, inlined DRAFT + DRAFT_WEEK1, scoring data)
- Prints full summary with standings, top scorers, 2x players, and undrafted players
- **Fuzzy-matches unrecognized player names** against draft and suggests `name_map.json` entries
- **Exits with error (code 1)** if name mismatches are detected — must fix before committing

## 2. Review the output
- If the script **exited with error** (name mismatches found):
  1. Check each suggested match — add correct mappings to `scripts/name_map.json`
  2. Re-run the sync script — repeat until it exits cleanly
- If the script says game is not in week config — add it to `scripts/week_config.json`
- Check for any players NOT in fantasy teams — report these to the user
- Verify the standings and top scorers look reasonable

## 3. Commit and push
- Only proceed if the script exited cleanly (no name mismatches)
- Stage all changed/new files (including `week_config.json` if updated)
- Commit with a descriptive message
- Push to origin main
