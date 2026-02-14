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
    let branchLabel = status.isDetachedHead
      ? `HEAD (detached)`
      : status.branch;

    if (status.hasUpstream) {
      if (status.ahead === 0 && status.behind === 0) {
        branchLabel += '  ✅ in sync';
      } else {
        if (status.ahead > 0) {branchLabel += `  ⬆${status.ahead}`;}
        if (status.behind > 0) {branchLabel += `  ⬇${status.behind}`;}
      }
    } else {
      branchLabel += '  (no upstream)';
    }
    children.push(new InfoNode(branchLabel, 'git-branch'));

    // Dirty status
    if (status.dirtyFileCount > 0) {
      children.push(new InfoNode(`${status.dirtyFileCount} uncommitted change(s)`, 'warning'));
    } else {
      children.push(new InfoNode('Clean working tree', 'check'));
    }

    // Notes
    if (repo.notes) {
      const snippet = repo.notes.length > 60 ? repo.notes.substring(0, 57) + '...' : repo.notes;
      children.push(new InfoNode(`📝 ${snippet}`, 'note'));
    }

    // Worktrees (skip the main worktree which is the repo itself)
    const extraWorktrees = status.worktrees.filter(
      (w) => path.normalize(w.path) !== path.normalize(repo.path)
    );
    if (extraWorktrees.length > 0) {
      for (const wt of extraWorktrees) {
        children.push(new InfoNode(`🌳 ${wt.branch || 'detached'} → ${wt.path}`, 'git-branch'));
      }
    }

    // Last commit
    if (status.lastCommit) {
      children.push(
        new InfoNode(
          `${status.lastCommit.hash} ${status.lastCommit.message} (${status.lastCommit.relativeTime})`,
          'git-commit'
        )
      );
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
    this.iconPath = new vscode.ThemeIcon('repo');

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
  constructor(label: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

class MessageNode extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
  }
}
