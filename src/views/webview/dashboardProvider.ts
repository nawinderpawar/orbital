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
        case 'addNote': {
          const note = this.dataStore.addNote(msg.repoId, msg.text);
          if (note && this.panel) {
            this.panel.webview.postMessage({ command: 'noteAdded', repoId: msg.repoId, note });
          }
          break;
        }
        case 'deleteNote':
          this.dataStore.deleteNote(msg.repoId, msg.timestamp);
          break;
        case 'clearNotes':
          this.dataStore.clearNotes(msg.repoId);
          this.refresh();
          break;
        case 'archiveNotes': {
          const archiveFile = this.dataStore.archiveNotes(msg.repoId);
          if (archiveFile && this.panel) {
            this.panel.webview.postMessage({
              command: 'archiveComplete',
              repoId: msg.repoId,
              archiveFile,
            });
          }
          this.refresh();
          break;
        }
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
      --note-border: var(--vscode-textSeparator-foreground, rgba(128,128,128,0.35));
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
    .header-remove-btn {
      background: none;
      border: none;
      color: var(--vscode-foreground);
      opacity: 0.3;
      cursor: pointer;
      font-size: 1em;
      padding: 2px 6px;
      border-radius: 3px;
      line-height: 1;
    }
    .header-remove-btn:hover {
      opacity: 1;
      background: var(--badge-dirty);
      color: #000;
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
    .commit-info {
      font-size: 0.82em;
      opacity: 0.7;
      font-family: var(--vscode-editor-font-family);
    }

    /* ── Notes Journal ─────────────────────────────── */
    .notes-section {
      margin-top: 8px;
      border: 1px solid var(--card-border);
      border-radius: 4px;
      overflow: hidden;
    }
    .notes-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: var(--vscode-sideBarSectionHeader-background, rgba(128,128,128,0.1));
      cursor: pointer;
      user-select: none;
    }
    .notes-header:hover {
      opacity: 0.85;
    }
    .notes-header-left {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: bold;
      font-size: 0.85em;
    }
    .notes-toggle {
      font-size: 0.75em;
      opacity: 0.6;
    }
    .notes-count {
      font-size: 0.8em;
      opacity: 0.6;
      font-weight: normal;
    }
    .notes-archive-btn {
      background: none;
      border: none;
      color: var(--vscode-foreground);
      opacity: 0.5;
      cursor: pointer;
      font-size: 0.8em;
      padding: 2px 6px;
      border-radius: 3px;
    }
    .notes-archive-btn:hover {
      opacity: 1;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .notes-body {
      max-height: 300px;
      overflow-y: auto;
      transition: max-height 0.2s ease;
    }
    .notes-body.collapsed {
      max-height: 0;
      overflow: hidden;
    }
    .note-input-row {
      display: flex;
      gap: 6px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--note-border);
    }
    .note-input {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 3px;
      padding: 5px 8px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      outline: none;
    }
    .note-input:focus {
      border-color: var(--vscode-focusBorder);
    }
    .note-input::placeholder {
      opacity: 0.5;
    }
    .note-entry {
      padding: 6px 10px;
      border-bottom: 1px solid var(--note-border);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }
    .note-entry:last-child {
      border-bottom: none;
    }
    .note-content {
      flex: 1;
    }
    .note-text {
      font-size: 0.9em;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .note-timestamp {
      font-size: 0.75em;
      opacity: 0.5;
      margin-top: 2px;
    }
    .note-delete {
      opacity: 0;
      background: none;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      font-size: 0.8em;
      padding: 2px 4px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .note-entry:hover .note-delete {
      opacity: 0.5;
    }
    .note-delete:hover {
      opacity: 1 !important;
      background: var(--badge-dirty);
      color: #000;
    }
    .notes-empty {
      padding: 12px 10px;
      text-align: center;
      opacity: 0.4;
      font-size: 0.85em;
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
  </style>
</head>
<body>
  ${cardsHtml}
  <script>
    const vscode = acquireVsCodeApi();

    function removeRepo(repoId) {
      vscode.postMessage({ command: 'removeRepo', repoId });
    }
    function openFolder(path) {
      vscode.postMessage({ command: 'openFolder', path });
    }
    function openTerminal(repoId) {
      vscode.postMessage({ command: 'openTerminal', repoId });
    }
    function archiveNotes(repoId) {
      if (confirm('Archive all notes to file and start fresh?')) {
        vscode.postMessage({ command: 'archiveNotes', repoId });
      }
    }

    // Toggle notes collapse
    function toggleNotes(repoId) {
      const body = document.getElementById('notes-body-' + repoId);
      const toggle = document.getElementById('notes-toggle-' + repoId);
      if (body && toggle) {
        body.classList.toggle('collapsed');
        toggle.textContent = body.classList.contains('collapsed') ? '▶' : '▼';
      }
    }

    // Add note on Enter
    document.querySelectorAll('.note-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          const repoId = input.dataset.repoid;
          vscode.postMessage({ command: 'addNote', repoId, text });
          input.value = '';
        }
      });
    });

    // Delete note
    function deleteNote(repoId, timestamp) {
      vscode.postMessage({ command: 'deleteNote', repoId, timestamp });
      const el = document.getElementById('note-' + repoId + '-' + CSS.escape(timestamp));
      if (el) el.remove();
      // Update count
      const countEl = document.getElementById('notes-count-' + repoId);
      const listEl = document.getElementById('notes-body-' + repoId);
      if (countEl && listEl) {
        const remaining = listEl.querySelectorAll('.note-entry').length;
        countEl.textContent = remaining > 0 ? remaining + ' note' + (remaining > 1 ? 's' : '') : '';
      }
    }

    // Handle noteAdded from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'noteAdded') {
        const list = document.getElementById('notes-list-' + msg.repoId);
        const emptyMsg = document.getElementById('notes-empty-' + msg.repoId);
        if (emptyMsg) emptyMsg.remove();
        if (list) {
          const ts = new Date(msg.note.timestamp);
          const div = document.createElement('div');
          div.className = 'note-entry';
          div.id = 'note-' + msg.repoId + '-' + msg.note.timestamp;
          div.innerHTML =
            '<div class="note-content">' +
              '<div class="note-text">' + escHtml(msg.note.text) + '</div>' +
              '<div class="note-timestamp">' + ts.toLocaleString() + '</div>' +
            '</div>' +
            '<button class="note-delete" onclick="deleteNote(\\'' + msg.repoId + '\\', \\'' + msg.note.timestamp + '\\')">✕</button>';
          list.insertBefore(div, list.firstChild);
          // Update count
          const countEl = document.getElementById('notes-count-' + msg.repoId);
          if (countEl) {
            const total = list.querySelectorAll('.note-entry').length;
            countEl.textContent = total + ' note' + (total > 1 ? 's' : '');
          }
        }
      }
    });

    function escHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
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

    // Notes journal — newest first
    const notes = Array.isArray(entry.notes) ? entry.notes : [];
    const sortedNotes = [...notes].reverse();
    const noteCount = sortedNotes.length;
    const notesListHtml = noteCount > 0
      ? sortedNotes.map((n) => {
          const ts = new Date(n.timestamp);
          return `<div class="note-entry" id="note-${entry.id}-${this.escHtml(n.timestamp)}">
            <div class="note-content">
              <div class="note-text">${this.escHtml(n.text)}</div>
              <div class="note-timestamp">${this.escHtml(ts.toLocaleString())}</div>
            </div>
            <button class="note-delete" onclick="deleteNote('${entry.id}', '${this.escAttr(n.timestamp)}')">✕</button>
          </div>`;
        }).join('')
      : `<div class="notes-empty" id="notes-empty-${entry.id}">No notes yet. Type below and press Enter.</div>`;

    return `<div class="card">
      <div class="card-header">
        <h3>${this.escHtml(name)}</h3>
        <button class="header-remove-btn" onclick="removeRepo('${entry.id}')" title="Remove from Orbital">✕</button>
      </div>
      <div class="card-path">${this.escHtml(entry.path)}</div>
      <div class="badges">${badges.join('')}</div>
      ${wtHtml}
      ${commitHtml}
      <div class="notes-section">
        <div class="notes-header">
          <div class="notes-header-left" onclick="toggleNotes('${entry.id}')">
            <span class="notes-toggle" id="notes-toggle-${entry.id}">▼</span>
            <span>📝 Notes</span>
            <span class="notes-count" id="notes-count-${entry.id}">${noteCount > 0 ? noteCount + ' note' + (noteCount > 1 ? 's' : '') : ''}</span>
          </div>
          ${noteCount > 0 ? `<button class="notes-archive-btn" onclick="archiveNotes('${entry.id}')" title="Archive notes to file and clear">📦 Archive</button>` : ''}
        </div>
        <div class="notes-body" id="notes-body-${entry.id}">
          <div class="note-input-row">
            <input type="text" class="note-input" data-repoid="${entry.id}" placeholder="Add a note... (Enter to save)" />
          </div>
          <div id="notes-list-${entry.id}">
            ${notesListHtml}
          </div>
        </div>
      </div>
      <div class="actions">
        <button onclick="openFolder('${this.escAttr(entry.path)}')">📂 Open Folder</button>
        <button onclick="openTerminal('${entry.id}')">💻 Terminal</button>
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
