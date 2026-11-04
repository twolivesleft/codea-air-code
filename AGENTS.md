# Codea Air Code (VS Code extension)

Editor and debugger for Codea projects. Projects are kept in local folders, linked
to Codea and synced over Air Code (see Linked folders). Codea's files are also
served under the `codea://` scheme (`registerFileSystemProvider` in
`src/extension.ts`), which the sync uses, and through which VS Code opens what is
not linked: a debugger stop in an unlinked project, an Assets view preview. A
`codea://` workspace is not supported: a window still opened on one is offered to
move to a local folder, keeping its host and the projects it had open. The Codea
side lives in codea-super (`AirCode/`,
`Core/Codea/Air Code/`).

## Building

```bash
npm install
npm run compile        # tsc into out/
npx @vscode/vsce package -o /tmp/codea-air-code.vsix
code --install-extension /tmp/codea-air-code.vsix   # replaces the Marketplace build
```

`npm run lint` fails before checking anything: the repo has no ESLint config.

## Linked folders

A linked folder is a local folder kept in sync with a Codea project (`src/links.ts`
for the settings and path mapping, `src/sync.ts` for the sync, `src/syncplan.ts` for
the decision per file, which `npx mocha --ui tdd out/test/suite/syncplan.test.js`
tests). Commands, the debugger and the language server still talk to Codea with
`codea://` URIs: `Links` rewrites local paths to them and back. Codea's debugger
matches a breakpoint by what follows `/Codea/` in its path, unencoded.

Codea runs commands in id order and answers only its newest connection. Do not use
`getInformation` to check a connection: on Codea versions before the fix it resets
the expected id and can stall every later command. `ensureResponsive` sends a stat.

### Deletions (read before changing the sync)

On 2026-11-01 the sync deleted 369 files on a user's device: their linked folders were
emptied while disconnected, Disconnect did not survive the reload, and the first sync took
every remembered-but-missing file as a deletion. Codea deletes outright and its iCloud
folder keeps no recoverable copy, so most were restored from git and some were lost,
including files in iCloud projects shared with other people. The rules that prevent it:

- A deletion is only passed on when it was seen happening: a local delete seen by the file
  watcher, or a deletion Codea reported (`guardDeletion` in `src/syncplan.ts`, unit
  tested). A full sync (connect, reload, linking) never deletes; it brings files back.
- More than 5 local deletions at once ask first; anything but an explicit yes restores.
- A linked project folder missing on either side is never synced; the user is asked to
  get it again or unlink it.
- Disconnect is kept in a file in the workspace storage, and the sync records in files
  saved within half a second (`BaseStore`): VS Code's own state is lost when it is killed.

The end-to-end checks for these (three runs on one profile, as reloads) are described in
the linked-folders handoff; run them after any change to `src/sync.ts`.

## Go to Definition (LuaLS)

Definitions come from the Lua extension (`sumneko.lua`), which `src/luals.ts` configures in the
folder's settings: `luals/api/*.lua` as a library (Codea's API) and `luals/plugin.lua`, which makes
`X = class()` a type, reads `x = require(asset...)` as the globals, and declares the global a
`parameter.number/integer/boolean/text/color("Name", ...)` call makes. The folder counts as set up
when `Lua.runtime.plugin` names that plugin; there is no setting of its own, which a window that
updated the extension without reloading would not know. `Lua.workspace.ignoreDir` lists every
folder but the linked projects (entries starting with `/`; LuaLS has no `!` to re-include). The local
projects they require or depend on, found beside them or in a folder named after the collection, are
added to `Lua.workspace.library`, for their definitions without their warnings; `ignoreDir` names each
of those itself, since LuaLS reads no library inside a folder it ignores. A watcher on `*.lua` and
`Info.plist` keeps both current. A required project created while LuaLS runs, under a path with a
space, was not read as a library until LuaLS restarted. Its completion and signature
help are turned off; its diagnostics stay on, because they are what makes LuaLS read again a file
changed on disk. A change made just after a file was created is taken for its creation, and missed.

`luals/api` is generated from codea-super's reference, Carbide JSON and legacy YAML. Run it again
when Codea's API changes:

```bash
npm run generate-lua-api -- ~/Git/codea-super
```

`.e2e/luals.js` checks it against the simulator with LuaLS installed:
`LUALS=<extensions dir with sumneko.lua> .e2e/run.sh luals`.

## Releasing

Publishing is automated with Marketplace Trusted Publishing (GitHub OIDC). No
token is involved: Azure DevOps PATs are retired from December 1, 2026, and
`vsce login` / `vsce publish` from a Mac no longer work.

1. In a PR, bump `version` in `package.json` (`npm install --package-lock-only`
   updates the lockfile) and add a `## X.Y.Z (YYYY/MM/DD)` entry to
   `CHANGELOG.md`. Merge it.
2. Tag the merged `main` and push the tag:
   ```bash
   git checkout main && git pull --ff-only
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
3. `.github/workflows/publish.yml` checks the tag against `package.json`,
   publishes with `vsce publish --oidc`, and creates a GitHub release with the
   `.vsix` and that changelog entry as notes. Follow it with
   `gh run watch -R twolivesleft/codea-air-code`.

The Marketplace accepts the version at once, but `vsce show
twolivesleft.codea-air-code` can keep listing the old one for several minutes.

Trusted Publishing works only from that workflow: the policy on the
`twolivesleft` publisher (Marketplace management page, *Trusted Publishing*)
names this repository, `publish.yml` and the `marketplace` environment.
Renaming the workflow file or the environment breaks publishing until the
policy is updated to match. If the workflow cannot run, the fallback is to
upload the packaged `.vsix` by hand on that same management page.
