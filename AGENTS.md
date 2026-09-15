# Tetris maintenance

- Gameplay lives in `scripts/main.js`; `scene/scene.json` defines the camera and
  visible controls. Keep keyboard and touch actions on the same game rules.
- `pocketrealms.json` defines the publication version, supported runtime and
  explicit payload. Bump its version for changed game content.
- Snapshot/restore must capture the board, falling piece, sequence, timing,
  counters and game-over state. Resume releases physical inputs.
- Use the compiled runtime pinned in the manifest. Run `npm test` and
  `npm run test:browser` against the final game before publishing; actual browser
  input and rendered state establish gameplay behavior.
- CI calls the public PocketRealms API with `POCKETREALMS_API_KEY`. Keep credentials
  in the environment or GitHub secrets, outside the game payload and test output.
- This is a pre-alpha demo. Release switches reset existing play sessions;
  preserve working save/resume within the selected release.
