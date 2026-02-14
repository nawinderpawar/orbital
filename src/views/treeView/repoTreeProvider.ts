import * as vscode from 'vscode';
import * as path from 'path';
import { DataStore } from '../../data/dataStore';
import { GitService } from '../../git/gitService';
import { RepoEntry, RepoStatus } from '../../types';

export class RepoTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private statusCache = new Map<string, RepoStatus>();

  constructor(
    private dataStore: DataStore,
    private gitService: GitService
  ) {}

  refresh(): void {
    this.statusCache.clear();
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

    return [];
  }

  private getRepoChildren(repo: RepoEntry, status: RepoStatus): TreeNode[] {
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

    // Notes
    if (repo.notes) {
      const snippet = repo.notes.length > 60 ? repo.notes.substring(0, 57) + '...' : repo.notes;
      children.push(new InfoNode(snippet, 'bookmark', 'charts.blue', repo.notes));
    }

    // Worktrees (skip the main worktree which is the repo itself)
    const extraWorktrees = status.worktrees.filter(
      (w) => path.normalize(w.path) !== path.normalize(repo.path)
    );
    if (extraWorktrees.length > 0) {
      for (const wt of extraWorktrees) {
        children.push(new InfoNode(
          `${wt.branch || 'detached'} → ${path.basename(wt.path)}`,
          'list-tree',
          'charts.purple',
          `Worktree: ${wt.path}`
        ));
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

    return children;
  }
}

// ── Tree Node Types ───────────────────────────────────

type TreeNode = RepoNode | InfoNode | MessageNode;

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
