# Change Log

## 1.3.9 (2026/11/02)
- Go to Definition, Find All References and hover in linked projects, through the Lua extension by sumneko, which Codea Air Code sets up with Codea's API, its `class()`, `require(asset...)` and the globals `parameter` functions make, for the linked projects and the projects they use
- Unlink Folder, in the Explorer and the Projects section, stops syncing a folder and keeps its files on both sides
- The Projects section can show only the linked projects
- Link Folder can link a folder holding a project to a new project in Codea, made with its files, and New Project named like such a folder uses its files
- Files changed on both sides are asked about in a dialog after linking, reloading or reconnecting, and those still waiting are shown in the status bar until resolved
- Link Folder's dialog can pick a `.codea` project folder on macOS, which Codea registers as a package
## 1.3.8 (2026/11/02)
- Projects are kept in local folders linked to Codea and synced both ways, so search, source control and AI coding assistants work with them
- Projects view: get, link and play Codea's projects; New Project and Delete Project in Codea; renaming a project folder renames it in Codea
- Folders inside projects (Codea 3.20); renamed tabs keep their place
- Dependencies shown and edited per project, with modern projects' `require` (Codea 3.20); breakpoints in a linked dependency's files
- Assets view: browse packs, drag keys into code, add, rename and delete files; link an asset pack to a folder
- Safeguards against passing on deletions: missing projects and many deletions ask first, nothing is deleted while disconnected
- A window opened on codea://, the old way to connect, offers to move to a local folder; the Codea Search view is removed, as VS Code's search works on the local files
- Reference view: the Modern tab browses the Carbide reference, and Find Reference looks in the reference of the file's project first (Codea 3.20)
- Completion lists each name once with its signatures and description, and signature help covers the Carbide API (Codea 3.20); files in folders get completion too
- When Codea misses the first command of a new connection, it is sent again instead of waiting 15 seconds
## 1.3.7 (2026/11/01)
- Cmd+Shift+F (Ctrl+Shift+F) opens the Codea search, filled in with the selection or the word under the cursor
- The Codea search no longer needs a code file to be focused

## 1.3.6 (2025/01/14)
- New 'Set runtime...' command to switch a project between legacy and modern

## 1.3.5 (2024/04/17)
- Fixing missing modules in packaged extension

## 1.3.4 (2024/04/17)
- Use Bonjour to detect running instances of Codea on the local network

## 1.3.3 (2024/04/10)
- Support for iCloud projects

## 1.3.2 (2024/04/02)
- Implemented and documented support for connecting over USB
- Exposed modern documentation

## 1.3.1 (2024/03/09)
- Release version of 1.3.0

## 1.3.0 (pre-release, 2024/03/04)
- Binary assets support (read, write and rename)
- Refresh breakpoints on save

## 1.2.5 (2023/10/27)
- Added basic project search feature through a new sidebar view.

## 1.2.4 (pre-release, 2023/09/03)
- Added ability to rename symbols.

## 1.2.3 (pre-release, 2023/08/23)
- Added Codea reference to the Codea Sidebar.
  - New 'Find reference...' command to go directly to the corresponding reference page.

## 1.2.2 (pre-release, 2023/08/14)
- Auto-completion using a new Air Code Language Server Protocol.
  - Access to the same auto-completion as available in Codea.
  - Custom completion for 'if', 'for', 'while' and 'repeat'.
  - Signature help for functions of the Codea API.

## 1.2.1 (pre-release, 2023/07/24)
- Fixed parameter view issues on Windows.

## 1.2.0 (pre-release, 2023/07/24)

- Prevent creating a file if it already exists with a different casing.
- Show the Codea output channel when opening a Codea workspace.
- All Codea projects are now available form the Explorer view.
- Add a "Play ProjetName in Codea" status bar button.

## 1.1.5 (2023/05/29)

- Better connection status indication.
- Fixed line ending issues for files created under Windows.

## 1.1.4 (2023/05/29)

- Automatically connect the debugger when a project is running.
- Replace the connection notifications with a status bar message.
- Support debugging Codea projects running in a new window.

## 1.1.3 (2023/05/23)

- Added support for showing notifications from Codea such as Lua load errors.

## 1.1.2 (2023/05/23)

- Keep opened tabs after closing a project.

## 1.1.1 (2023/05/22)

- Fixed an issue with too many sockets being opened.

## 1.1.0 (2023/05/22)

- Added conditional breakpoints support.
- Improved folders hierarchy.
- Fixed connection loss issues.
- Added version compatibility checks.

## 1.0.0 (2023/05/08)

- Initial release
