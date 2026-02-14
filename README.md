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

## Development

```bash
cd orbital
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```
