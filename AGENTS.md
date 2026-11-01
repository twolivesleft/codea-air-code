# Codea Air Code (VS Code extension)

Remote editor and debugger for Codea projects. Files are served by Codea over
Air Code and appear in VS Code under the `codea://` scheme
(`registerFileSystemProvider` in `src/extension.ts`). The Codea side lives in
codea-super (`AirCode/`, `Core/Codea/Air Code/`).

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

## Search

VS Code's Find in Files cannot search `codea://` files (linked folders are local and
use the built-in search). It needs a
`TextSearchProvider`/`FileSearchProvider`, and both are still proposed APIs
(microsoft/vscode#59921, #73524), which Marketplace extensions cannot use. So
search is our own webview view (`src/search.ts`, `media/search/`), which asks
Codea to run it (`AirCode.findInFiles`), and Cmd+Shift+F is rebound to it in
Codea workspaces. Check those issues before building anything on the built-in
search.

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
