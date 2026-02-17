import { execFile } from 'child_process';
import { RepoStatus, WorktreeInfo, CommitSummary } from '../types';

function git(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repoPath, ...args], { timeout: 10000, shell: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export class GitService {
  async getStatus(repoPath: string): Promise<RepoStatus> {
    try {
      const [branch, dirty, aheadBehind, worktrees, lastCommit, remoteUrl] =
        await Promise.allSettled([
          this.getBranch(repoPath),
          this.getDirtyCount(repoPath),
          this.getAheadBehind(repoPath),
          this.getWorktrees(repoPath),
          this.getLastCommit(repoPath),
          this.getRemoteUrl(repoPath),
        ]);

      const branchResult = branch.status === 'fulfilled' ? branch.value : 'unknown';
      const isDetached = branchResult === 'HEAD';

      return {
        branch: branchResult,
        isDetachedHead: isDetached,
        ahead: aheadBehind.status === 'fulfilled' ? aheadBehind.value.ahead : 0,
        behind: aheadBehind.status === 'fulfilled' ? aheadBehind.value.behind : 0,
        hasUpstream: aheadBehind.status === 'fulfilled',
        dirtyFileCount: dirty.status === 'fulfilled' ? dirty.value : 0,
        worktrees: worktrees.status === 'fulfilled' ? worktrees.value : [],
        lastCommit: lastCommit.status === 'fulfilled' ? lastCommit.value : null,
        remoteUrl: remoteUrl.status === 'fulfilled' ? remoteUrl.value : null,
      };
    } catch (err: any) {
      return {
        branch: 'unknown',
        isDetachedHead: false,
        ahead: 0,
        behind: 0,
        hasUpstream: false,
        dirtyFileCount: 0,
        worktrees: [],
        lastCommit: null,
        remoteUrl: null,
        error: err.message,
      };
    }
  }

  private async getBranch(repoPath: string): Promise<string> {
    return git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  }

  private async getDirtyCount(repoPath: string): Promise<number> {
    const output = await git(repoPath, ['status', '--porcelain']);
    if (!output) {return 0;}
    return output.split('\n').filter((l) => l.trim().length > 0).length;
  }

  private async getAheadBehind(repoPath: string): Promise<{ ahead: number; behind: number }> {
    const output = await git(repoPath, [
      'rev-list',
      '--left-right',
      '--count',
      'HEAD...@{upstream}',
    ]);
    const [ahead, behind] = output.split('\t').map(Number);
    return { ahead: ahead || 0, behind: behind || 0 };
  }

  private async getWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
    const output = await git(repoPath, ['worktree', 'list', '--porcelain']);
    if (!output) {return [];}

    const worktrees: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> = {};

    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) {
          worktrees.push(current as WorktreeInfo);
        }
        current = { path: line.substring(9), branch: '', isBareBranch: false };
      } else if (line.startsWith('branch ')) {
        // refs/heads/main -> main
        current.branch = line.substring(7).replace('refs/heads/', '');
      } else if (line === 'bare') {
        current.isBareBranch = true;
      } else if (line === '') {
        if (current.path) {
          worktrees.push(current as WorktreeInfo);
          current = {};
        }
      }
    }
    if (current.path) {
      worktrees.push(current as WorktreeInfo);
    }

    return worktrees;
  }

  private async getLastCommit(repoPath: string): Promise<CommitSummary> {
    const output = await git(repoPath, ['log', '-1', '--format=%h\t%s\t%cr']);
    const [hash, message, relativeTime] = output.split('\t');
    return { hash, message, relativeTime };
  }

  private async getRemoteUrl(repoPath: string): Promise<string> {
    return git(repoPath, ['remote', 'get-url', 'origin']);
  }
}
