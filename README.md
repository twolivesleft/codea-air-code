# Codea Air Code

This extension can connect remotely to the [Codea](https://codea.io/) iOS application, allowing to modify, tweak and debug Codea projects directly from Visual Studio Code.

## Table of Contents 

- [Features](#features)
  - [Editor](#editor)
  - [Parameters](#parameters)
  - [Debugger](#debugger)
- [Usage](#usage)
  - [Connection](#connection)
  - [Files and Dependencies](#files-and-dependencies)
  - [Commands](#commands)
- [Requirements](#requirements)
- [License](#license)
- [Change Log](#change-log)

## Features

### Editor

Once connected to Codea, Visual Studio Code will list the files for the currently opened project, allowing to modify them, even if the project is running.

<img width="720" alt="Screenshot of the editor" src="images/editor.png">

### Parameters

The Codea button on the Visual Studio Code Sidebar will show the current parameters for the running project in Codea, if any.

All parameters can be controlled directly from Visual Studio Code even if the parameters are hidden in Codea, making it easier to tweak the projects.

<img width="255" alt="Screenshot of parameters" src="images/parameters.png">

### Debugger

With a project running, Visual Studio Code can be used to attach to the running project and then used for debugging.

Some features such as conditional breakpoints or modifying variables are not available yet but will be added in future updates of Codea and the extension.

<img width="806" alt="Screenshot of the debugger" src="images/debugger.png">

## Usage

### Connection

After installing the extension, open the Command Palette (Ctrl+Shift+P on Windows, ⇧⌘P on Mac), and run the `Codea: Connect to Host...` command to connect to a running instance of Codea on an iOS device. After typing Enter or selecting the command, Visual Studio Code will ask for Codea's IP.

To find the device's IP to connect to, use the Air Code icon on the project selection screen in Codea. The default port is `18513`.

#### Fun Fact

> The idea for this extension started as a proof-of-concept of a browser based "Remote Console". The idea was to see a Codea project's logs and execute commands directly from a web browser.
>
> Air Code's default port 18513 is actually based on the letters R (18) E (5) M (13), for REMote console.

### Files and Dependencies

Files can be added, removed or renamed in Codea using the corresponding operations in Visual Studio Code.

Dependencies can be added to the active project using the `Add dependency...` command.

To remove a dependency, simply delete its corresponding folder in the Explorer.

### Commands

All commands included with this extension are prefixed with `Codea:`.

| Command                | Description                                                      |
|------------------------|------------------------------------------------------------------|
| `Connect to Host...`   | Enter the IP and port to connect to a running instance of Codea. |
| `Execute current line` | Executes the Lua code on the active line.                        |
| `Execute selection`    | Executes the select Lua code in Codea.                           |
| `Execute command...`   | Enter a Lua command to execute in Codea.                         |
| `Restart project`      | Restart the running project in Codea.                            |
| `Add dependency...`    | Select a dependency to add to the active Codea project.          |

## Requirements

Codea 3.8

<a href="http://itunes.apple.com/app/id439571171?mt=8"><img height="40" alt="Screenshot of the editor" src="images/App-Store-Badge.png"></a>

## License
[MIT License](LICENSE)

## Change Log
See the change log [here](CHANGELOG.md)
