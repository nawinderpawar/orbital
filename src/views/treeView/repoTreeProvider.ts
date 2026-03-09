import * as vscode from 'vscode';
import * as path from 'path';
import { DataStore } from '../../data/dataStore';
import { GitService } from '../../git/gitService';
import { RepoEntry, RepoStatus, DiffStats, DiffFileInfo } from '../../types';

export class RepoTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private statusCache = new Map<string, RepoStatus>();
  private diffCache = new Map<string, DiffStats>();

  private treeView?: vscode.TreeView<TreeNode>;

  constructor(
    private dataStore: DataStore,
    private gitService: GitService
  ) {}

  setTreeView(tv: vscode.TreeView<TreeNode>): void {
    this.treeView = tv;
  }

  /** Full refresh — clears all caches including diffs */
  refresh(): void {
    this.statusCache.clear();
    this.diffCache.clear();
    if (this.treeView) { this.treeView.message = '$(sync~spin) Refreshing...'; }
    this._onDidChangeTreeData.fire();
    // Clear message after a short delay (tree will have re-rendered)
    setTimeout(() => { if (this.treeView) { this.treeView.message = undefined; } }, 500);
  }

  /** Soft refresh — clears only status cache, preserves diff cache (used by poll) */
  softRefresh(): void {
    this.statusCache.clear();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      // Root: list repos — fetch all statuses in parallel
      const repos = this.dataStore.getRepos();
      if (repos.length === 0) {
        return [new MessageNode('No repositories tracked. Use + to add one.')];
      }
      const statuses = await Promise.all(
        repos.map(async (repo) => {
          let status = this.statusCache.get(repo.id);
          if (!status) {
            status = await this.gitService.getStatus(repo.path);
            this.statusCache.set(repo.id, status);
          }
          return { repo, status };
        })
      );
      return statuses.map(({ repo, status }) => new RepoNode(repo, status));
    }

    if (element instanceof RepoNode) {
      return this.getRepoChildren(element.repo, element.status);
    }

    if (element instanceof DiffNode) {
      // uncommittedFiles is the only async fetch here — cache it
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
    // Diff vs base branch (fetch in parallel with the rest of the children building)
    const diffPromise = (async (): Promise<DiffStats | null> => {
      let diffStats = this.diffCache.get(repo.id);
      if (diffStats) { return diffStats; }
      try {
        const baseBranch = repo.baseBranch || await this.gitService.getDefaultBranch(repo.path);
        diffStats = await this.gitService.getDiffStats(repo.path, baseBranch, true);
        this.diffCache.set(repo.id, diffStats);
        return diffStats;
      } catch {
        return null;
      }
    })();

    // Build non-diff children immediately
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
        children.push(new WorktreeNode(wt.branch || 'detached', wt.path, repo.baseBranch));
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

    // Diff vs base branch — await the parallel promise
    const diffStats = await diffPromise;
    if (diffStats && diffStats.files.length > 0) {
      const node = new DiffNode(
        `${diffStats.files.length} file(s) changed vs ${diffStats.baseBranch}  +${diffStats.totalAdditions} -${diffStats.totalDeletions}`,
        repo.path,
        diffStats,
        repo.id
      );
      children.push(node);
    }

    return children;
  }

  private async getWorktreeChildren(wt: WorktreeNode): Promise<TreeNode[]> {
    const children: TreeNode[] = [];
    try {
      const baseBranch = wt.repoBaseBranch || await this.gitService.getDefaultBranch(wt.worktreePath);
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

    this.id = `repo-${repo.id}`;
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
  constructor(label: string, icon: string, color?: string, tooltipText?: string, nodeId?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (nodeId) { this.id = nodeId; }
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
    public readonly worktreePath: string,
    public readonly repoBaseBranch?: string
  ) {
    super(`🌳 ${branch} → ${path.basename(worktreePath)}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `wt-${worktreePath}-${repoBaseBranch || 'auto'}`;
    this.iconPath = new vscode.ThemeIcon('list-tree', new vscode.ThemeColor('charts.purple'));
    this.tooltip = `Worktree: ${worktreePath}`;
  }
}

class DiffNode extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly repoPath: string,
    public readonly diffStats: DiffStats,
    public readonly repoId?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `diff-${repoPath}-${diffStats.baseBranch}`;
    this.contextValue = repoId ? 'diffNode' : undefined;
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
    const statusLetter = file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : file.status === 'renamed' ? 'R' : 'M';
    super(`${statusLetter}  ${fileName}`, vscode.TreeItemCollapsibleState.None);

    this.id = `difffile-${repoPath}-${file.filePath}`;

    const isUncommitted = uncommittedFiles.has(file.filePath);
    this.description = dir !== '.' ? dir : '';
    this.tooltip = `${file.filePath}\n+${file.additions} -${file.deletions}\n${isUncommitted ? 'Uncommitted' : 'Committed'}`;

    // Icon shows commit status: cloud for committed, pencil for uncommitted
    if (isUncommitted) {
      this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.orange'));
    } else {
      this.iconPath = new vscode.ThemeIcon('cloud-upload', new vscode.ThemeColor('charts.green'));
    }

    // Click opens native VS Code diff
    this.command = {
      command: 'orbital.openFileDiff',
      title: 'Open Diff',
      arguments: [repoPath, file.filePath, baseBranch, gitService],
    };
  }
}
