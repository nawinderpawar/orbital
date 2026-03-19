import { execFile } from 'child_process';
import { RepoStatus, WorktreeInfo, CommitSummary, DiffStats, DiffFileInfo } from '../types';

// Resolve git path once at module load
let resolvedGitPath: string | null = null;

function findGitPath(): string {
  if (resolvedGitPath) { return resolvedGitPath; }
  // Try common locations on Windows
  const candidates = [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
  ];
  const fs = require('fs');
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      resolvedGitPath = p;
      return p;
    }
  }
  // Fallback: rely on PATH via shell
  resolvedGitPath = 'git';
  return 'git';
}

function git(repoPath: string, args: string[], timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const gitPath = findGitPath();
    const useShell = gitPath === 'git'; // only use shell when we couldn't resolve the path
    execFile(gitPath, ['-C', repoPath, ...args], { timeout: timeoutMs, shell: useShell, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export class GitService {
  // Caches with TTL
  private defaultBranchCache = new Map<string, { value: string; expiresAt: number }>();
  private branchListCache = new Map<string, { value: { local: string[]; remote: string[] }; expiresAt: number }>();

  private static DEFAULT_BRANCH_TTL = 5 * 60 * 1000;  // 5 minutes
  private static BRANCH_LIST_TTL = 2 * 60 * 1000;     // 2 minutes
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

  // ── Diff Operations ─────────────────────────────────

  /** Resolve the default branch (main or master) — cached */
  async getDefaultBranch(repoPath: string): Promise<string> {
    const cached = this.defaultBranchCache.get(repoPath);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    let result = 'main';
    // Try common default branch names
    for (const candidate of ['main', 'master']) {
      try {
        await git(repoPath, ['rev-parse', '--verify', candidate]);
        result = candidate;
        break;
      } catch {
        // not found, try next
      }
    }
    if (result === 'main') {
      // Fallback: use the first remote HEAD
      try {
        const output = await git(repoPath, ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short']);
        result = output.replace('origin/', '');
      } catch {
        // keep 'main'
      }
    }

    this.defaultBranchCache.set(repoPath, { value: result, expiresAt: Date.now() + GitService.DEFAULT_BRANCH_TTL });
    return result;
  }

  /**
   * Get diff stats between current branch and base.
   * @param includeUncommitted If true, diffs working tree vs base. If false, diffs HEAD vs base.
   */
  async getDiffStats(repoPath: string, baseBranch: string, includeUncommitted: boolean): Promise<DiffStats> {
    // committed only: diff main...HEAD --numstat
    // all incl uncommitted: diff main --numstat
    const diffRef = includeUncommitted ? baseBranch : `${baseBranch}...HEAD`;
    const output = await git(repoPath, ['diff', diffRef, '--numstat'], 30000);

    const files: DiffFileInfo[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    if (output) {
      for (const line of output.split('\n')) {
        if (!line.trim()) {continue;}
        const parts = line.split('\t');
        if (parts.length < 3) {continue;}

        const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
        const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
        let filePath = parts[2];

        // Handle renames: "old => new" or "{old => new}/path"
        let status: DiffFileInfo['status'] = 'modified';
        if (filePath.includes(' => ')) {
          status = 'renamed';
          // Extract the new name
          filePath = filePath.replace(/\{[^}]+ => ([^}]+)\}/g, '$1').replace(/.+ => (.+)/, '$1');
        }

        files.push({ filePath, additions, deletions, status });
        totalAdditions += additions;
        totalDeletions += deletions;
      }
    }

    // Determine added/deleted status by checking if file exists on base
    if (files.length > 0) {
      try {
        const nameStatusOutput = await git(repoPath, ['diff', diffRef, '--name-status']);
        const statusMap = new Map<string, string>();
        for (const line of nameStatusOutput.split('\n')) {
          if (!line.trim()) {continue;}
          const tab = line.indexOf('\t');
          if (tab > 0) {
            const s = line.substring(0, tab).trim();
            const f = line.substring(tab + 1).trim();
            statusMap.set(f, s);
          }
        }
        for (const file of files) {
          const s = statusMap.get(file.filePath);
          if (s === 'A') {file.status = 'added';}
          else if (s === 'D') {file.status = 'deleted';}
          else if (s?.startsWith('R')) {file.status = 'renamed';}
          else if (s === 'M') {file.status = 'modified';}
        }
      } catch {
        // name-status failed, keep defaults
      }
    }

    // Append untracked files when including uncommitted changes
    if (includeUncommitted) {
      try {
        const untrackedOutput = await git(repoPath, ['ls-files', '--others', '--exclude-standard']);
        if (untrackedOutput) {
          const trackedPaths = new Set(files.map((f) => f.filePath));
          for (const line of untrackedOutput.split('\n')) {
            const filePath = line.trim();
            if (filePath && !trackedPaths.has(filePath)) {
              files.push({ filePath, additions: 0, deletions: 0, status: 'added' });
            }
          }
        }
      } catch {
        // ls-files failed, skip untracked
      }
    }

    return { baseBranch, includesUncommitted: includeUncommitted, files, totalAdditions, totalDeletions };
  }

  /** Get file content at a specific ref (for native diff) */
  async getFileAtRef(repoPath: string, ref: string, filePath: string): Promise<string> {
    return git(repoPath, ['show', `${ref}:${filePath}`], 30000);
  }

  /** Get set of file paths that have uncommitted changes (staged, unstaged, or untracked) */
  async getUncommittedFiles(repoPath: string): Promise<Set<string>> {
    const output = await git(repoPath, ['status', '--porcelain']);
    const files = new Set<string>();
    if (!output) { return files; }
    for (const line of output.split('\n')) {
      if (!line.trim()) { continue; }
      // porcelain format: XY filename  (or XY old -> new for renames)
      // ?? for untracked files
      const filePath = line.substring(3).split(' -> ').pop()!.trim();
      files.add(filePath);
    }
    return files;
  }

  /** List all local and remote-tracking branches — cached */
  async listBranches(repoPath: string): Promise<{ local: string[]; remote: string[] }> {
    const cached = this.branchListCache.get(repoPath);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    const [localOutput, remoteOutput] = await Promise.allSettled([
      git(repoPath, ['branch', '--format=%(refname:short)']),
      git(repoPath, ['branch', '-r', '--format=%(refname:short)']),
    ]);

    const local = localOutput.status === 'fulfilled' && localOutput.value
      ? localOutput.value.split('\n').map((b) => b.trim()).filter((b) => b.length > 0)
      : [];

    const remote = remoteOutput.status === 'fulfilled' && remoteOutput.value
      ? remoteOutput.value.split('\n')
          .map((b) => b.trim())
          .filter((b) => b.length > 0 && !b.includes('/HEAD'))
      : [];

    const result = { local, remote };
    this.branchListCache.set(repoPath, { value: result, expiresAt: Date.now() + GitService.BRANCH_LIST_TTL });
    return result;
  }
}
