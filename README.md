# Tetris

A browser game published to PocketRealms. This repository owns the gameplay,
scene, package manifest and tests. It needs no PocketRealms checkout, backend
workspace, or cloud account to build and playtest.

The local **0.3.0** release declares its six generic buttons and keyboard/widget
mappings in `inputs.json`. Atlas renders the controls and resolves holds and
repeat timing; the game consumes `game.input` and `onControl`. Publish the pinned
supporting runtime and CLI 0.3.0 before publishing this release or downloading
those artifacts with the commands below.

Use Node 22 and Python 3.12:

```sh
python tools/install-cli.py
npm ci
npm run runtime
npx playwright install chromium
npm test
npm run test:browser
pocketrealms validate .
```

The runtime and CLI are pinned by checksum. Atlas source is not part of this
repository; its compiled test/runtime artifacts are downloaded from PocketRealms.

Create a publisher key under **Profile → Publisher keys** in PocketRealms. Give
it read and publish permissions; after creating this module, restrict its CI key
to the module ID. Store the key in the repository's `POCKETREALMS_API_KEY` secret.
Each push to `main` tests keyboard/touch gameplay and save/restore in real WASM,
then runs `pocketrealms deploy .`. Game releases do not deploy the platform.

For manual publication, export `POCKETREALMS_API_KEY` in your environment and run
`pocketrealms deploy . --visibility public`. Change the version in
`pocketrealms.json` when changing game content. A release switch resets previous
play sessions in this pre-alpha; save/resume works within the selected release.

Arrow keys move/rotate, Space drops, and R restarts. The on-screen controls support
touch. Use PocketRealms' **Pause & save** control before leaving a game.
