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

## Search

VS Code's Find in Files cannot search `codea://` files. It needs a
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
