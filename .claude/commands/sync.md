A new game JSON file has been added: $ARGUMENTS

Run the automated sync script, then review and commit:

## 1. Run the sync script
```
node scripts/sync_game.js $ARGUMENTS
```
This handles everything automatically:
- Parses the ESPN Cricinfo game JSON
- Calculates all fantasy points (batting/bowling/fielding)
- Applies conditional uncapped 2x multiplier
- Generates `scoring_gameN.json`
- Recomputes `draft_data.json` from all scoring files
- Updates `index.html` (new tab, inlined data, stats)
- Prints full summary with standings, top scorers, 2x players, and undrafted players

## 2. Review the output
- Check for any flagged name mismatches — if found, add them to `scripts/name_map.json` and re-run
- Check for any players NOT in fantasy teams — report these to the user
- Verify the standings and top scorers look reasonable

## 3. Commit and push
- Stage all changed/new files
- Commit with a descriptive message
- Push to origin main
