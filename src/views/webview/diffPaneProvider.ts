import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { GitService } from '../../git/gitService';
import { DiffStats, DiffFileInfo } from '../../types';

export class DiffPaneProvider {
  private panel?: vscode.WebviewPanel;
  private currentRepoPath?: string;
  private currentRepoName?: string;

  constructor(
    private extensionUri: vscode.Uri,
    private gitService: GitService
  ) {}

  async open(repoPath: string, repoName: string): Promise<void> {
    this.currentRepoPath = repoPath;
    this.currentRepoName = repoName;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      await this.refresh();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'orbital.diffPane',
      `⚡ Diff: ${repoName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'orbital.svg');

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'openFileDiff':
          await this.openNativeDiff(msg.filePath, msg.baseBranch, msg.includeUncommitted);
          break;
        case 'refresh':
          await this.refresh(msg.includeUncommitted);
          break;
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    await this.refresh();
  }

  async refresh(includeUncommitted?: boolean): Promise<void> {
    if (!this.panel || !this.currentRepoPath) { return; }

    const baseBranch = await this.gitService.getDefaultBranch(this.currentRepoPath);
    const committed = await this.gitService.getDiffStats(this.currentRepoPath, baseBranch, false).catch(() => null);
    const all = await this.gitService.getDiffStats(this.currentRepoPath, baseBranch, true).catch(() => null);

    this.panel.webview.html = this.buildHtml(committed, all, includeUncommitted ?? false);
  }

  private async openNativeDiff(filePath: string, baseBranch: string, includeUncommitted: boolean): Promise<void> {
    if (!this.currentRepoPath) { return; }

    const repoPath = this.currentRepoPath;
    const repoName = this.currentRepoName || path.basename(repoPath);
    const absolutePath = path.join(repoPath, filePath);
    const fileName = path.basename(filePath);

    // Left side: file at base branch
    let leftUri: vscode.Uri;
    try {
      const baseContent = await this.gitService.getFileAtRef(repoPath, baseBranch, filePath);
      // Write to a temp file for the diff editor
      const tmpDir = path.join(os.tmpdir(), 'orbital-diff');
      if (!fs.existsSync(tmpDir)) { fs.mkdirSync(tmpDir, { recursive: true }); }
      const tmpFile = path.join(tmpDir, `${baseBranch}_${fileName}`);
      fs.writeFileSync(tmpFile, baseContent, 'utf-8');
      leftUri = vscode.Uri.file(tmpFile);
    } catch {
      // File doesn't exist on base (newly added)
      const tmpDir = path.join(os.tmpdir(), 'orbital-diff');
      if (!fs.existsSync(tmpDir)) { fs.mkdirSync(tmpDir, { recursive: true }); }
      const tmpFile = path.join(tmpDir, `${baseBranch}_${fileName}`);
      fs.writeFileSync(tmpFile, '', 'utf-8');
      leftUri = vscode.Uri.file(tmpFile);
    }

    // Right side: working copy (all) or HEAD version (committed only)
    let rightUri: vscode.Uri;
    if (includeUncommitted) {
      rightUri = vscode.Uri.file(absolutePath);
    } else {
      try {
        const headContent = await this.gitService.getFileAtRef(repoPath, 'HEAD', filePath);
        const tmpDir = path.join(os.tmpdir(), 'orbital-diff');
        const tmpFile = path.join(tmpDir, `HEAD_${fileName}`);
        fs.writeFileSync(tmpFile, headContent, 'utf-8');
        rightUri = vscode.Uri.file(tmpFile);
      } catch {
        rightUri = vscode.Uri.file(absolutePath);
      }
    }

    const label = `${fileName} (${baseBranch} ↔ ${includeUncommitted ? 'working tree' : 'HEAD'})`;
    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, label);
  }

  private buildHtml(committed: DiffStats | null, all: DiffStats | null, showUncommitted: boolean): string {
    const active = showUncommitted ? all : committed;
    const baseBranch = active?.baseBranch || committed?.baseBranch || 'main';

    const fileListHtml = active && active.files.length > 0
      ? this.buildFileList(active)
      : '<div class="empty-state">No changes found vs <strong>' + this.escHtml(baseBranch) + '</strong></div>';

    const committedCount = committed?.files.length || 0;
    const allCount = all?.files.length || 0;

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 12px;
      margin: 0;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      flex-wrap: wrap;
      gap: 8px;
    }
    .header h2 {
      margin: 0;
      font-size: 1.2em;
    }
    .header-sub {
      font-size: 0.85em;
      opacity: 0.6;
    }
    .toggle-bar {
      display: flex;
      gap: 4px;
      margin-bottom: 12px;
    }
    .toggle-btn {
      padding: 5px 14px;
      border: 1px solid var(--vscode-panel-border);
      background: transparent;
      color: var(--vscode-foreground);
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85em;
    }
    .toggle-btn.active {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-color: var(--vscode-badge-background);
    }
    .toggle-btn:hover:not(.active) {
      background: var(--vscode-list-hoverBackground);
    }
    .stats-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 12px;
      font-size: 0.9em;
    }
    .stat { font-weight: bold; }
    .stat.files { color: var(--vscode-foreground); }
    .stat.add { color: #89d185; }
    .stat.del { color: #f48771; }
    .file-list {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      overflow: hidden;
    }
    .dir-group-header {
      padding: 6px 10px;
      background: var(--vscode-sideBarSectionHeader-background, rgba(128,128,128,0.1));
      font-weight: bold;
      font-size: 0.85em;
      opacity: 0.8;
    }
    .file-row {
      display: flex;
      align-items: center;
      padding: 5px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--vscode-textSeparator-foreground, rgba(128,128,128,0.2));
      gap: 8px;
    }
    .file-row:last-child { border-bottom: none; }
    .file-row:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .file-icon {
      flex-shrink: 0;
      width: 18px;
      text-align: center;
      font-size: 0.85em;
    }
    .file-icon.added { color: #89d185; }
    .file-icon.modified { color: #e2c08d; }
    .file-icon.deleted { color: #f48771; }
    .file-icon.renamed { color: #4ec9b0; }
    .file-name {
      flex: 1;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .file-stats {
      flex-shrink: 0;
      font-size: 0.8em;
      display: flex;
      gap: 6px;
    }
    .file-stats .add { color: #89d185; }
    .file-stats .del { color: #f48771; }
    .empty-state {
      text-align: center;
      padding: 40px 16px;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h2>⚡ Changes: ${this.escHtml(this.currentRepoName || '')}</h2>
      <div class="header-sub">Comparing against <strong>${this.escHtml(baseBranch)}</strong></div>
    </div>
  </div>
  <div class="toggle-bar">
    <button class="toggle-btn ${!showUncommitted ? 'active' : ''}" onclick="switchMode(false)">
      Committed only (${committedCount} files)
    </button>
    <button class="toggle-btn ${showUncommitted ? 'active' : ''}" onclick="switchMode(true)">
      All incl. uncommitted (${allCount} files)
    </button>
  </div>
  ${active ? `<div class="stats-bar">
    <span class="stat files">${active.files.length} file(s) changed</span>
    <span class="stat add">+${active.totalAdditions}</span>
    <span class="stat del">-${active.totalDeletions}</span>
  </div>` : ''}
  ${fileListHtml}
  <script>
    const vscode = acquireVsCodeApi();
    const state = vscode.getState() || { includeUncommitted: false };

    function switchMode(includeUncommitted) {
      state.includeUncommitted = includeUncommitted;
      vscode.setState(state);
      vscode.postMessage({ command: 'refresh', includeUncommitted });
    }

    function openFile(filePath, baseBranch, includeUncommitted) {
      vscode.postMessage({ command: 'openFileDiff', filePath, baseBranch, includeUncommitted });
    }
  </script>
</body>
</html>`;
  }

  private buildFileList(stats: DiffStats): string {
    // Group by directory
    const groups = new Map<string, DiffFileInfo[]>();
    for (const f of stats.files) {
      const dir = path.dirname(f.filePath);
      if (!groups.has(dir)) { groups.set(dir, []); }
      groups.get(dir)!.push(f);
    }

    // Sort directories
    const sortedDirs = [...groups.keys()].sort();
    let html = '<div class="file-list">';

    for (const dir of sortedDirs) {
      const files = groups.get(dir)!;
      if (sortedDirs.length > 1 || dir !== '.') {
        html += `<div class="dir-group-header">📁 ${this.escHtml(dir === '.' ? '(root)' : dir)}</div>`;
      }
      for (const f of files) {
        const icon = f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : f.status === 'renamed' ? 'R' : 'M';
        const fileName = path.basename(f.filePath);
        html += `<div class="file-row" onclick="openFile('${this.escAttr(f.filePath)}', '${this.escAttr(stats.baseBranch)}', ${stats.includesUncommitted})">
          <span class="file-icon ${f.status}">${icon}</span>
          <span class="file-name" title="${this.escHtml(f.filePath)}">${this.escHtml(fileName)}</span>
          <span class="file-stats">
            ${f.additions > 0 ? `<span class="add">+${f.additions}</span>` : ''}
            ${f.deletions > 0 ? `<span class="del">-${f.deletions}</span>` : ''}
          </span>
        </div>`;
      }
    }

    html += '</div>';
    return html;
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
