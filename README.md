# Codea Air Code

This extension connects Visual Studio Code to the [Codea](https://codea.io/) iOS application. Your projects are kept in a folder on your computer, in sync with Codea, so you can edit them with Visual Studio Code and any other tool, then play, tweak and debug them on your device. Auto-completion and documentation features similar to Codea are available while working on the projects.

## Table of Contents 

- [Features](#features)
  - [Projects in Local Folders](#projects-in-local-folders)
  - [Editor](#editor)
  - [Sidebar](#sidebar)
  - [Debugger](#debugger)
- [Installation](#installation)
- [Usage](#usage)
  - [Getting Started](#getting-started)
  - [Linked Folders](#linked-folders)
  - [Connection](#connection)
  - [USB Connection](#usb-connection)
  - [Files and Dependencies](#files-and-dependencies)
  - [Assets](#assets)
  - [Commands](#commands)
- [Requirements](#requirements)
- [License](#license)
- [Change Log](#change-log)

## Features

### Projects in Local Folders

Each project is kept in a regular folder on your computer, linked to the project in Codea. Because the files are local, everything works with them: Visual Studio Code's search, source control such as git, and other extensions and tools, including AI coding assistants. Changes are sent to Codea as soon as they are saved, and changes made on the device come back on their own, even while a project is running.

A folder can hold many projects, the same way Codea organizes them, so a git repository of your Codea projects can be opened and linked as it is.

<img width="851" alt="A folder of Codea projects" src="images/linked_folder.png">

### Editor

The editor knows Codea's API and your project: auto-completion, color pickers, font and sprite lists, snippets and documentation work much like in Codea.

#### Auto-Completion

Auto-completion is available for the Codea API as well as symbols defined in the project and its dependencies.

#### Symbols

<img width="527" alt="Objc auto-completion" src="images/autocomplete_5.png">

#### Colors

Methods such as `background`, `fill`, `tint`, `stroke` and `color` will show a color indicator which can be used to visualize and easily change the assigned color using VSCode's color picker.

<img width="441" alt="Color Auto-Completion" src="images/autocomplete_1.png">

#### Font and Sprites

The `font` and `sprite` functions will automatically list the fonts and sprites available for the current project.

<img width="448" alt="Font Auto-Completion" src="images/autocomplete_2.png">

<img width="442" alt="Aprite Auto-Completion" src="images/autocomplete_3.png">

#### Snippets

Snippets make it easier to format the different Lua control structures such as `if`, `for`, `while` and `repeat`.

<img width="136" alt="Code Snippet" src="images/autocomplete_4.png">

#### Documentation

Types can easily be documented using a triple-slash (`---`) comment.

<img width="486" alt="Auto Documentation" src="images/document_1.png">

### Sidebar

The Codea Sidebar gives access to the Projects, Reference and Parameters sections.

#### Projects

The Projects section lists the collections and projects in Codea. Click the download button next to a project to get a copy in your folder, linked to Codea (see [Linked Folders](#linked-folders)). Linked projects can be played from the list, or revealed in the Explorer.

To get all your projects at once, click the download button at the top of the section, or the one next to a collection to get all of its projects. Codea's built-in collections, such as Examples, are left out of the first, but each of their projects can still be got on its own.

<img width="420" alt="Projects" src="images/projects.png">

#### Reference

The Codea Reference section of the Sidebar contains the full documentation for Codea Legacy (3.x) and Modern (4.x) which can be navigated by clicking on the different chapters and functions.

It is also possible to select and right click a word in a project's code to find the corresponding reference in the Legacy documentation (or using the `Find reference...` command), automatically focusing on the sidebar and opening the corresponding page.

<img width="318" alt="Sidebar" src="images/sidebar_6.png">

<img width="318" alt="Sidebar" src="images/sidebar_7.png">

<img width="384" alt="Sidebar" src="images/sidebar_8.png">

#### Search

The files are on your computer, so Visual Studio Code's own search works as usual, across all your projects.

<img width="851" alt="Searching linked projects" src="images/local_search.png">

#### Parameters

The second section of the Codea Sidebar will show the current parameters for the running project, if any.

All parameters can be controlled directly from Visual Studio Code even if the parameters are hidden in Codea, making it easier to tweak the projects.

<img width="302" alt="Parameters" src="images/parameters_2.png">

### Debugger

With a project running, Visual Studio Code can be used to attach to the running project and then used for debugging.

Values of variables and watches can be modified while the execution is paused.

<img width="806" alt="Debugger" src="images/debugger.png">

#### Conditional Breakpoints

To set a condition on a breakpoint, right click a breakpoint and select `Edit Breakpoint...`:

<img width="457" alt="Edit breakpoint" src="images/edit_breakpoint.png">

Enter a valid Lua expression which must be `true` for the breakpoint to hit.

<img width="319" alt="Breakpoint condition" src="images/breakpoint_condition.png">

#### Log Points

Log Messages can be set on breakpoints to print the message in the Debug Console instead of breaking the execution. This can also be used to print the result of expressions within curly braces as can be seen in the following example:

<img width="821" alt="Logpoint" src="images/logpoint.png">

## Installation

Search for "Codea Air Code" in Visual Studio Code's Marketplace and install the extension.

<img width="302" alt="Installation" src="images/marketplace.png">

## Usage

### Getting Started

The `Codea: Get Started with Codea Projects` command opens a walkthrough of these steps.

1. Open a folder for your projects with `File > Open Folder...`: an empty folder to start, or one you already have, such as a git repository of Codea projects.
2. In the Codea Sidebar, open the Projects section and click `Connect to Codea` (see [Connection](#connection)).
3. Click the download button next to a project to get it, or the one at the top of the section to get all your projects. Projects are copied into your folder the same way Codea organizes its files (`Project.codea` for Documents, `Collection/Project.codea` for other collections).
4. If your folder already holds your projects, laid out the same way, run `Codea: Link All Matching Folders...` to link them all to the projects of the same name in Codea, or right-click one project's folder in the Explorer and choose `Codea: Link Folder to Project...`.
5. Edit the project, then play it with the play button in the status bar.

### Linked Folders

A linked folder is a regular folder on your computer that the extension keeps in sync with a project in Codea. Playing, debugging, auto-completion and parameters work with Codea as they would on the device.

Links are saved in the workspace's `.vscode/settings.json`:

```json
{
    "codea-air-code.host": "192.168.1.10:18513",
    "codea-air-code.links": {
        "EmuTests.codea": "iPad Projects/EmuTests"
    }
}
```

Changes are kept in sync both ways:

- Files saved here, created, deleted, or changed by any other tool are sent to Codea right away.
- Changes made in Codea, or by another app on the device, come back within a second. With older versions of Codea, linked folders are checked every 10 seconds instead.
- If a file changed on both sides, you will be asked whether to keep the local version or Codea's, and you can compare them first. Nothing is overwritten until you choose. When many projects are linked at once, the files that differ are listed together, to keep one side for all of them or review each.

The Codea items in the status bar show the connection and play the project you are working on. Clicking the Codea item shows a menu to sync, reconnect or link a folder. Syncing can also be started with the button at the top of the Explorer.

<img width="165" alt="Status bar" src="images/status_bar_idle.png">

While the project is running, the play button becomes a stop button.

<img width="165" alt="Status bar while running" src="images/status_bar_running.png">

### Connection

To connect your folder to Codea, click `Connect to Codea` in the Projects section of the Codea Sidebar, or run the `Codea: Connect to Codea...` command from the Command Palette (Ctrl+Shift+P on Windows, ⇧⌘P on Mac). Visual Studio Code will ask to select a device or enter the IP and port to connect to:

<img width="596" alt="Host Connection" src="images/connect_2.png">

To find the device's IP to connect to if the device is not in the list, use the Air Code icon on the project selection screen in Codea. The default port is `18513`. The address is saved with the folder's settings, so the folder reconnects on its own the next time it is opened.

Clicking the Codea item in the status bar shows a menu to disconnect, reconnect, or connect to another device. While disconnected, changes stay where they are made, and are synced when the folder connects again.

#### Fun Fact

> The idea for this extension started as a proof-of-concept of a browser based "Remote Console". The idea was to see a Codea project's logs and execute commands directly from a web browser.
>
> Air Code's default port 18513 is actually based on the letters R (18) E (5) M (13), for REMote console.

### USB Connection

If Wi-Fi is not accessible or is slow, you can connect to Codea over a USB connection using iproxy, a utility part of libusbmuxd (or libimobiledevice).

For Mac and Linux platforms, libusbmuxd can be installed through Homebrew using `brew install libusbmuxd` (refer to [https://brew.sh/](https://brew.sh/) for Homebrew installation).

Windows executables including iproxy.exe are also available (look for `libimobiledevice windows binaries`). Make sure iTunes is installed on your Windows system and that the directory of iproxy.exe is included in your PATH environment variable.

Once iproxy is available, connect to Codea and, instead of an address, enter the port used in Codea for Air Code followed by a local port to open on your computer, for example `18513:18514`.

#### Multi-window

Air Code does not currently support multiple Codea windows or running projects. For this reason, when running a project from Air Code, all windows will be closed except one before running the project.

### Files and Dependencies

Files added, removed or renamed in a project's folder, from Visual Studio Code or any other tool, are added, removed or renamed in Codea as well.

Dependencies can be added to the active project (based on the current file being edited) using the `Add dependency...` command. They are stored in the project's `Info.plist`, which is updated in the folder too.


### Assets

Assets kept in a project, such as images, sounds and models, are part of its folder and are synced like any other file, so new assets can be added by copying them into the project's folder.

To reference an asset in a project, drag-and-drop the asset from the Explorer view **while holding the Shift key** into a Lua file and the Asset Key will automatically be added.

<img width="738" alt="Dragging an Asset" src="images/asset_drag.png">

<img width="398" alt="Asset Key" src="images/asset_key.png">

### Commands

All commands included with this extension are prefixed with `Codea:`.

| Command                | Description                                                           |
|------------------------|-----------------------------------------------------------------------|
| `Get Started with Codea Projects` | Open the walkthrough of working with Codea projects.       |
| `Connect to Codea...`  | Connect the open folder to Codea, to get and link its projects.       |
| `Get All Projects`     | Get every project from Codea into the open folder, linked.            |
| `Link All Matching Folders...` | Link the folder's projects to the projects of the same name in Codea. |
| `Link Folder to Project...` | Keep a local folder in sync with a project in Codea.             |
| `Sync Linked Folders`  | Sync all linked folders with Codea now.                               |
| `Disconnect`           | Disconnect the folder from Codea until you connect again.             |
| `Execute current line` | Executes the Lua code on the active line.                             |
| `Execute selection`    | Executes the select Lua code in Codea.                                |
| `Execute command...`   | Enter a Lua command to execute in Codea.                              |
| `Restart project`      | Restart the running project in Codea.                                 |
| `Add dependency...`    | Select a dependency to add to the active Codea project.               |
| `Find reference...`    | Look-up the reference for the selected word.                          |
| `Set runtime...`       | Change the current project's runtime between legacy and modern.       |

## Requirements

Codea 3.10. With versions of Codea that do not report changes made on the device, linked folders are checked for them every 10 seconds.

<a href="http://itunes.apple.com/app/id439571171?mt=8"><img height="40" alt="Screenshot of the editor" src="images/App-Store-Badge.png"></a>

## License
[MIT License](LICENSE)

## Change Log
See the change log [here](CHANGELOG.md)
