# Orbital 🛸

> Track everything in your orbit.

**Orbital** is a VS Code extension that gives you a single dashboard to monitor all your parallel workstreams across multiple git repositories.

## Features

- **📂 Repository Tracking** — Add any git repo on your machine and see its status at a glance
- **🌿 Branch & Sync Status** — See the current branch, ahead/behind counts, and whether your working tree is clean
- **🌳 Worktree Awareness** — View all git worktrees for each repository
- **📝 Workstream Notes** — Attach freeform notes to each repo to track context that isn't in code
- **📊 Webview Dashboard** — Rich card-based dashboard with inline note editing
- **🔄 Auto-Refresh** — Polls repos every 30 seconds (configurable)

## Getting Started

1. Open VS Code and install the Orbital extension
2. Click the Orbital icon (🛸) in the Activity Bar
3. Click **+** to add a repository
4. See your repos appear in the TreeView and Dashboard

## Commands

| Command | Description |
|---|---|
| `Orbital: Add Repository` | Add a git repo to track |
| `Orbital: Remove Repository` | Stop tracking a repo |
| `Orbital: Edit Notes` | Add/edit workstream notes |
| `Orbital: Set Alias` | Give a repo a friendly name |
| `Orbital: Refresh All` | Force-refresh all repos |
| `Orbital: Open Dashboard` | Focus the dashboard webview |
| `Orbital: Open in New Window` | Open repo folder in new VS Code window |
| `Orbital: Open Terminal` | Open a terminal at the repo path |

## Configuration

| Setting | Default | Description |
|---|---|---|
| `orbital.pollIntervalSeconds` | `30` | How often to poll for git status updates |

## Data Storage

All data is stored in `~/.orbital/data.json`. This file is portable — copy it to another machine to bring your tracked repos and notes along.

## Building & Installing

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [Git](https://git-scm.com/)
- [Visual Studio Code](https://code.visualstudio.com/) v1.85 or later

### Build from source

```bash
cd c:\src\orbital
npm install
npm run compile
```

### Install in VS Code

#### Option 1: Package as VSIX (recommended)

```bash
# Install the VS Code Extension packaging tool (one-time)
npm install -g @vscode/vsce

# Package the extension
cd c:\src\orbital
vsce package

# This creates orbital-0.1.0.vsix in the project root
```

Then install the `.vsix` in VS Code:

- Open VS Code → **Extensions** sidebar (Ctrl+Shift+X)
- Click **⋯** (top-right of Extensions panel) → **Install from VSIX...**
- Select the generated `orbital-0.1.0.vsix` file

Or from the command line:

```bash
code --install-extension orbital-0.1.0.vsix
```

#### Option 2: Symlink for development

On Windows (run as Administrator):

```powershell
# Create a symlink in the VS Code extensions folder
New-Item -ItemType SymbolicLink `
  -Path "$env:USERPROFILE\.vscode\extensions\orbital" `
  -Target "c:\src\orbital"
```

On macOS/Linux:

```bash
ln -s /path/to/orbital ~/.vscode/extensions/orbital
```

Then reload VS Code (**Developer: Reload Window**). The extension will load directly from source — useful during development.

#### Option 3: Extension Development Host (F5)

1. Open `c:\src\orbital` in VS Code
2. Press **F5** to launch a new VS Code window with the extension loaded
3. Changes are picked up on each re-launch (or use `npm run watch` for live recompilation)

## Development

```bash
cd c:\src\orbital
npm install
npm run compile          # one-time build
npm run watch            # continuous build on file changes
# Press F5 in VS Code to launch Extension Development Host
```
