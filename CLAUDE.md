# averi

An MCP server (stdio, `bin` dist/mcp/server.js) that lets coding agents verify mobile app changes on iOS simulators and
Android emulators. TypeScript, Node 20+; `npm run lint`, `npm test`, `npm run build`. README.md for users,
ARCHITECTURE.md for the design, docs/adr/ for the decisions behind it.

## Releasing: binding

Any request to release averi, publish it, tag it, or bump its version, however it is worded, means following
**docs/release.md** from the top:

- Run gates A (off-device), B (Android, emulator-5554 only) and C (iOS, which the owner runs outside your sandbox) on
  one clean `main` equal to `origin/main`. The lab runs (`npm run truth:lab`, live.ts) are part of every release. They
  are not optional and they do not run on a schedule.
- Commit no version bump and no release record before A, B and C have passed. A failing gate stops the release, and so
  does an unproven one (exit 3, past its bound, or the device not up). Report it, and do not fix forward inside the
  release.
- Never start, restart or wipe an emulator or simulator to get a gate through. If one is not up, stop and tell the
  owner.
- Never tag, push or `npm publish`. Prepare the `chore(release): X.Y.Z` commit and the docs/releases/vX.Y.Z.md record,
  then hand the owner the commands.
