/** Persisted repo entry stored in ~/.orbital/data.json */
export interface RepoEntry {
  id: string;
  path: string;
  alias?: string;
  notes: NoteEntry[];
  addedAt: string;
}

/** A single timestamped note */
export interface NoteEntry {
  text: string;
  timestamp: string;
}

/** Top-level persisted data structure */
export interface OrbitalData {
  repos: RepoEntry[];
  settings: OrbitalSettings;
}

export interface OrbitalSettings {
  pollIntervalMs: number;
}

/** Live git status computed at runtime (never persisted) */
export interface RepoStatus {
  branch: string;
  isDetachedHead: boolean;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  dirtyFileCount: number;
  worktrees: WorktreeInfo[];
  lastCommit: CommitSummary | null;
  remoteUrl: string | null;
  error?: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  isBareBranch: boolean;
}

export interface CommitSummary {
  hash: string;
  message: string;
  relativeTime: string;
}

/** Combined view of a repo: persisted data + live status */
export interface RepoView {
  entry: RepoEntry;
  status: RepoStatus | null;
}
