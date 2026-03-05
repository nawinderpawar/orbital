import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { DataStore } from '../../data/dataStore';
import { GitService } from '../../git/gitService';
import { RepoEntry, RepoStatus, DiffStats, DiffFileInfo } from '../../types';

export class RepoTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private statusCache = new Map<string, RepoStatus>();
  private diffCache = new Map<string, DiffStats>();

  constructor(
    private dataStore: DataStore,
    private gitService: GitService
  ) {}

  refresh(): void {
    this.statusCache.clear();
    this.diffCache.clear();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      // Root: list repos
      const repos = this.dataStore.getRepos();
      if (repos.length === 0) {
        return [new MessageNode('No repositories tracked. Use + to add one.')];
      }
      const nodes: TreeNode[] = [];
      for (const repo of repos) {
        let status = this.statusCache.get(repo.id);
        if (!status) {
          status = await this.gitService.getStatus(repo.path);
          this.statusCache.set(repo.id, status);
        }
        nodes.push(new RepoNode(repo, status));
      }
      return nodes;
    }

    if (element instanceof RepoNode) {
      return this.getRepoChildren(element.repo, element.status);
    }

    if (element instanceof DiffNode) {
      let uncommitted: Set<string>;
      try {
        uncommitted = await this.gitService.getUncommittedFiles(element.repoPath);
      } catch {
        uncommitted = new Set();
      }
      return element.diffStats.files.map((f) => new DiffFileNode(f, element.repoPath, element.diffStats.baseBranch, this.gitService, uncommitted));
    }

    if (element instanceof WorktreeNode) {
      return this.getWorktreeChildren(element);
    }

    return [];
  }

  private async getRepoChildren(repo: RepoEntry, status: RepoStatus): Promise<TreeNode[]> {
    const children: TreeNode[] = [];

    // Branch + sync
    const branchLabel = status.isDetachedHead
      ? `HEAD (detached)`
      : status.branch;

    if (status.hasUpstream) {
      if (status.ahead === 0 && status.behind === 0) {
        children.push(new InfoNode(branchLabel, 'git-branch', 'charts.green', '✓ In sync with remote'));
      } else {
        const syncParts: string[] = [];
        if (status.ahead > 0) {syncParts.push(`${status.ahead} ahead`);}
        if (status.behind > 0) {syncParts.push(`${status.behind} behind`);}
        children.push(new InfoNode(
          `${branchLabel}  ⬆${status.ahead} ⬇${status.behind}`,
          'git-branch',
          'charts.yellow',
          `Out of sync: ${syncParts.join(', ')}`
        ));
      }
    } else {
      children.push(new InfoNode(`${branchLabel}  (no upstream)`, 'git-branch', 'disabledForeground', 'No upstream tracking branch configured'));
    }

    // Dirty status
    if (status.dirtyFileCount > 0) {
      children.push(new InfoNode(
        `${status.dirtyFileCount} uncommitted change(s)`,
        'circle-filled',
        'charts.red',
        `${status.dirtyFileCount} file(s) with uncommitted changes`
      ));
    } else {
      children.push(new InfoNode('Clean working tree', 'pass-filled', 'charts.green', 'No uncommitted changes'));
    }

    // Notes — show latest entry
    if (repo.notes && repo.notes.length > 0) {
      const latest = repo.notes[repo.notes.length - 1];
      const snippet = latest.text.length > 60 ? latest.text.substring(0, 57) + '...' : latest.text;
      const allNotes = repo.notes.map((n) => `[${new Date(n.timestamp).toLocaleString()}] ${n.text}`).join('\n');
      children.push(new InfoNode(
        `${snippet}  (${repo.notes.length} note${repo.notes.length > 1 ? 's' : ''})`,
        'bookmark',
        'charts.blue',
        allNotes
      ));
    }

    // Worktrees (skip the main worktree which is the repo itself)
    const extraWorktrees = status.worktrees.filter(
      (w) => path.normalize(w.path) !== path.normalize(repo.path)
    );
    if (extraWorktrees.length > 0) {
      for (const wt of extraWorktrees) {
        children.push(new WorktreeNode(wt.branch || 'detached', wt.path));
      }
    }

    // Last commit
    if (status.lastCommit) {
      children.push(new InfoNode(
        `${status.lastCommit.hash} ${status.lastCommit.message}`,
        'git-commit',
        'descriptionForeground',
        `Last commit: ${status.lastCommit.hash} ${status.lastCommit.message} (${status.lastCommit.relativeTime})`
      ));
    }

    // Diff vs main/master
    try {
      let diffStats = this.diffCache.get(repo.id);
      if (!diffStats) {
        const baseBranch = await this.gitService.getDefaultBranch(repo.path);
        diffStats = await this.gitService.getDiffStats(repo.path, baseBranch, true);
        this.diffCache.set(repo.id, diffStats);
      }
      if (diffStats.files.length > 0) {
        const node = new DiffNode(
          `${diffStats.files.length} file(s) changed vs ${diffStats.baseBranch}  +${diffStats.totalAdditions} -${diffStats.totalDeletions}`,
          repo.path,
          diffStats
        );
        children.push(node);
      }
    } catch {
      // diff failed (e.g. no main branch), skip
    }

    return children;
  }

  private async getWorktreeChildren(wt: WorktreeNode): Promise<TreeNode[]> {
    const children: TreeNode[] = [];
    try {
      const baseBranch = await this.gitService.getDefaultBranch(wt.worktreePath);
      const diffStats = await this.gitService.getDiffStats(wt.worktreePath, baseBranch, true);
      if (diffStats.files.length > 0) {
        children.push(new DiffNode(
          `${diffStats.files.length} file(s) changed vs ${diffStats.baseBranch}  +${diffStats.totalAdditions} -${diffStats.totalDeletions}`,
          wt.worktreePath,
          diffStats
        ));
      } else {
        children.push(new InfoNode('No changes vs ' + baseBranch, 'check', 'charts.green'));
      }
    } catch {
      children.push(new InfoNode('Diff not available', 'warning', 'charts.yellow'));
    }
    return children;
  }
}

// ── Tree Node Types ───────────────────────────────────

type TreeNode = RepoNode | InfoNode | MessageNode | DiffNode | DiffFileNode | WorktreeNode;

class RepoNode extends vscode.TreeItem {
  readonly repoId: string;

  constructor(
    public readonly repo: RepoEntry,
    public readonly status: RepoStatus
  ) {
    const label = repo.alias || path.basename(repo.path);
    super(label, vscode.TreeItemCollapsibleState.Expanded);

    this.repoId = repo.id;
    this.contextValue = 'repo';
    this.tooltip = repo.path;

    // Color the repo icon based on overall health
    if (status.error) {
      this.iconPath = new vscode.ThemeIcon('repo', new vscode.ThemeColor('charts.red'));
    } else if (status.dirtyFileCount > 0 || status.behind > 0) {
      this.iconPath = new vscode.ThemeIcon('repo', new vscode.ThemeColor('charts.yellow'));
    } else {
      this.iconPath = new vscode.ThemeIcon('repo', new vscode.ThemeColor('charts.green'));
    }

    // Description: branch + quick status
    const parts: string[] = [status.branch];
    if (status.dirtyFileCount > 0) {
      parts.push(`• ${status.dirtyFileCount} changed`);
    }
    if (status.ahead > 0) {parts.push(`⬆${status.ahead}`);}
    if (status.behind > 0) {parts.push(`⬇${status.behind}`);}
    this.description = parts.join(' ');
  }
}

class InfoNode extends vscode.TreeItem {
  constructor(label: string, icon: string, color?: string, tooltipText?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = color
      ? new vscode.ThemeIcon(icon, new vscode.ThemeColor(color))
      : new vscode.ThemeIcon(icon);
    if (tooltipText) {
      this.tooltip = tooltipText;
    }
  }
}

class MessageNode extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

class WorktreeNode extends vscode.TreeItem {
  constructor(
    branch: string,
    public readonly worktreePath: string
  ) {
    super(`🌳 ${branch} → ${path.basename(worktreePath)}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('list-tree', new vscode.ThemeColor('charts.purple'));
    this.tooltip = `Worktree: ${worktreePath}`;
  }
}

class DiffNode extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly repoPath: string,
    public readonly diffStats: DiffStats
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('diff', new vscode.ThemeColor('charts.orange'));
    this.tooltip = diffStats.files
      .map((f) => `${f.status[0].toUpperCase()} ${f.filePath} (+${f.additions} -${f.deletions})`)
      .join('\n');
  }
}

class DiffFileNode extends vscode.TreeItem {
  constructor(
    file: DiffFileInfo,
    repoPath: string,
    baseBranch: string,
    gitService: GitService,
    uncommittedFiles: Set<string>
  ) {
    const fileName = path.basename(file.filePath);
    const dir = path.dirname(file.filePath);
    super(fileName, vscode.TreeItemCollapsibleState.None);

    const isUncommitted = uncommittedFiles.has(file.filePath);
    const commitIndicator = isUncommitted ? 'U' : 'C';
    const dirPart = dir !== '.' ? dir + ' ' : '';
    this.description = `${dirPart}[${commitIndicator}]`;
    this.tooltip = `${file.filePath}\n+${file.additions} -${file.deletions}\n${isUncommitted ? 'Uncommitted' : 'Committed'}`;

    // Status-based icon
    const iconMap: Record<string, [string, string]> = {
      added: ['diff-added', 'charts.green'],
      modified: ['diff-modified', 'charts.yellow'],
      deleted: ['diff-removed', 'charts.red'],
      renamed: ['diff-renamed', 'charts.blue'],
    };
    const [icon, color] = iconMap[file.status] || ['diff-modified', 'charts.yellow'];
    this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));

    // Click opens native VS Code diff
    this.command = {
      command: 'orbital.openFileDiff',
      title: 'Open Diff',
      arguments: [repoPath, file.filePath, baseBranch, gitService],
    };
  }
}
