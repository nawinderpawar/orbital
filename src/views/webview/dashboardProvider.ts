import * as vscode from 'vscode';
import * as path from 'path';
import { DataStore } from '../../data/dataStore';
import { GitService } from '../../git/gitService';
import { RepoView } from '../../types';

export class DashboardProvider {
  private panel?: vscode.WebviewPanel;

  constructor(
    private extensionUri: vscode.Uri,
    private dataStore: DataStore,
    private gitService: GitService
  ) {}

  /** Open (or reveal) the dashboard in the main editor area */
  async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      await this.updateHtml();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'orbital.dashboard',
      '🛸 Orbital Dashboard',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
      }
    );

    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'orbital.svg');

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'saveNotes':
          this.dataStore.updateNotes(msg.repoId, msg.notes);
          break;
        case 'removeRepo':
          this.dataStore.removeRepo(msg.repoId);
          this.refresh();
          break;
        case 'openFolder':
          vscode.commands.executeCommand(
            'vscode.openFolder',
            vscode.Uri.file(msg.path),
            true
          );
          break;
        case 'openTerminal': {
          const repo = this.dataStore.getRepo(msg.repoId);
          if (repo) {
            const terminal = vscode.window.createTerminal({
              name: `Orbital: ${repo.alias || path.basename(repo.path)}`,
              cwd: repo.path,
            });
            terminal.show();
          }
          break;
        }
        case 'refresh':
          this.refresh();
          break;
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    await this.updateHtml();
  }

  async refresh(): Promise<void> {
    await this.updateHtml();
  }

  private async updateHtml(): Promise<void> {
    if (!this.panel) {return;}

    const repos = this.dataStore.getRepos();
    const views: RepoView[] = [];

    for (const entry of repos) {
      const status = await this.gitService.getStatus(entry.path);
      views.push({ entry, status });
    }

    this.panel.webview.html = this.buildHtml(views);
  }

  private buildHtml(repos: RepoView[]): string {
    const cardsHtml = repos.length === 0
      ? `<div class="empty">
           <p>🛸 No repositories in orbit yet.</p>
           <p>Use the <strong>+</strong> button in the Repositories panel to add one.</p>
         </div>`
      : repos.map((r) => this.buildCard(r)).join('\n');

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --card-bg: var(--vscode-editor-background);
      --card-border: var(--vscode-panel-border);
      --badge-ahead: #4ec9b0;
      --badge-behind: #ce9178;
      --badge-dirty: #f48771;
      --badge-clean: #89d185;
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 8px;
      margin: 0;
    }
    .empty {
      text-align: center;
      padding: 40px 16px;
      opacity: 0.7;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 10px;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .card-header h3 {
      margin: 0;
      font-size: 1.1em;
    }
    .card-path {
      font-size: 0.85em;
      opacity: 0.6;
      margin-bottom: 6px;
    }
    .badges {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .badge {
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.8em;
      font-weight: bold;
    }
    .badge.branch {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .badge.ahead { background: var(--badge-ahead); color: #000; }
    .badge.behind { background: var(--badge-behind); color: #000; }
    .badge.dirty { background: var(--badge-dirty); color: #000; }
    .badge.clean { background: var(--badge-clean); color: #000; }
    .section {
      margin: 6px 0;
    }
    .section-title {
      font-weight: bold;
      font-size: 0.85em;
      opacity: 0.8;
      margin-bottom: 4px;
    }
    .worktree-item {
      font-size: 0.85em;
      padding: 2px 0;
    }
    .notes-area {
      width: 100%;
      min-height: 50px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 6px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      resize: vertical;
      box-sizing: border-box;
    }
    .actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }
    .actions button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 4px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.85em;
    }
    .actions button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .actions button.danger {
      background: var(--badge-dirty);
      color: #000;
    }
    .commit-info {
      font-size: 0.82em;
      opacity: 0.7;
      font-family: var(--vscode-editor-font-family);
    }
  </style>
</head>
<body>
  ${cardsHtml}
  <script>
    const vscode = acquireVsCodeApi();

    function saveNotes(repoId) {
      const el = document.getElementById('notes-' + repoId);
      if (el) {
        vscode.postMessage({ command: 'saveNotes', repoId, notes: el.value });
      }
    }

    function removeRepo(repoId) {
      vscode.postMessage({ command: 'removeRepo', repoId });
    }

    function openFolder(path) {
      vscode.postMessage({ command: 'openFolder', path });
    }

    function openTerminal(repoId) {
      vscode.postMessage({ command: 'openTerminal', repoId });
    }

    // Auto-save notes on blur
    document.querySelectorAll('.notes-area').forEach(el => {
      el.addEventListener('blur', () => {
        const repoId = el.dataset.repoid;
        if (repoId) {
          vscode.postMessage({ command: 'saveNotes', repoId, notes: el.value });
        }
      });
    });
  </script>
</body>
</html>`;
  }

  private buildCard(rv: RepoView): string {
    const { entry, status } = rv;
    const name = entry.alias || path.basename(entry.path);
    const s = status!;

    // Badges
    const badges: string[] = [];
    badges.push(`<span class="badge branch">🌿 ${this.escHtml(s.branch)}</span>`);
    if (s.hasUpstream) {
      if (s.ahead === 0 && s.behind === 0) {
        badges.push('<span class="badge clean">✅ in sync</span>');
      } else {
        if (s.ahead > 0) {badges.push(`<span class="badge ahead">⬆ ${s.ahead}</span>`);}
        if (s.behind > 0) {badges.push(`<span class="badge behind">⬇ ${s.behind}</span>`);}
      }
    }
    if (s.dirtyFileCount > 0) {
      badges.push(`<span class="badge dirty">${s.dirtyFileCount} changed</span>`);
    } else {
      badges.push('<span class="badge clean">✨ Clean</span>');
    }

    // Worktrees
    const extraWt = s.worktrees.filter(
      (w) => path.normalize(w.path) !== path.normalize(entry.path)
    );
    const wtHtml = extraWt.length > 0
      ? `<div class="section">
           <div class="section-title">Worktrees</div>
           ${extraWt.map((w) => `<div class="worktree-item">🌳 ${this.escHtml(w.branch || 'detached')} → ${this.escHtml(w.path)}</div>`).join('')}
         </div>`
      : '';

    // Last commit
    const commitHtml = s.lastCommit
      ? `<div class="commit-info">${this.escHtml(s.lastCommit.hash)} ${this.escHtml(s.lastCommit.message)} (${this.escHtml(s.lastCommit.relativeTime)})</div>`
      : '';

    return `<div class="card">
      <div class="card-header">
        <h3>${this.escHtml(name)}</h3>
      </div>
      <div class="card-path">${this.escHtml(entry.path)}</div>
      <div class="badges">${badges.join('')}</div>
      ${wtHtml}
      ${commitHtml}
      <div class="section">
        <div class="section-title">Notes</div>
        <textarea class="notes-area" id="notes-${entry.id}" data-repoid="${entry.id}">${this.escHtml(entry.notes || '')}</textarea>
      </div>
      <div class="actions">
        <button onclick="openFolder('${this.escAttr(entry.path)}')">📂 Open Folder</button>
        <button onclick="openTerminal('${entry.id}')">💻 Terminal</button>
        <button class="danger" onclick="removeRepo('${entry.id}')">🗑 Remove</button>
      </div>
    </div>`;
  }

  private escHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private escAttr(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }
}
