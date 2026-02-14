import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OrbitalData, RepoEntry, NoteEntry } from '../types';

const ORBITAL_DIR = path.join(os.homedir(), '.orbital');
const DATA_FILE = path.join(ORBITAL_DIR, 'data.json');

function defaultData(): OrbitalData {
  return {
    repos: [],
    settings: { pollIntervalMs: 30000 },
  };
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

export class DataStore {
  private data: OrbitalData;

  constructor() {
    this.data = this.load();
  }

  // ── Read ──────────────────────────────────────────────

  getRepos(): RepoEntry[] {
    return [...this.data.repos];
  }

  getRepo(id: string): RepoEntry | undefined {
    return this.data.repos.find((r) => r.id === id);
  }

  getRepoByPath(repoPath: string): RepoEntry | undefined {
    const normalized = path.normalize(repoPath);
    return this.data.repos.find((r) => path.normalize(r.path) === normalized);
  }

  // ── Write ─────────────────────────────────────────────

  addRepo(repoPath: string, alias?: string): RepoEntry {
    const existing = this.getRepoByPath(repoPath);
    if (existing) {
      return existing;
    }
    const entry: RepoEntry = {
      id: generateId(),
      path: path.normalize(repoPath),
      alias,
      notes: [],
      addedAt: new Date().toISOString(),
    };
    this.data.repos.push(entry);
    this.save();
    return entry;
  }

  removeRepo(id: string): boolean {
    const before = this.data.repos.length;
    this.data.repos = this.data.repos.filter((r) => r.id !== id);
    if (this.data.repos.length < before) {
      this.save();
      return true;
    }
    return false;
  }

  addNote(id: string, text: string): NoteEntry | undefined {
    const repo = this.data.repos.find((r) => r.id === id);
    if (repo) {
      // Migrate legacy string notes
      if (!Array.isArray(repo.notes)) {
        const old = repo.notes as unknown;
        repo.notes = old ? [{ text: old as string, timestamp: new Date().toISOString() }] : [];
      }
      const entry: NoteEntry = { text, timestamp: new Date().toISOString() };
      repo.notes.push(entry);
      this.save();
      return entry;
    }
    return undefined;
  }

  deleteNote(id: string, timestamp: string): void {
    const repo = this.data.repos.find((r) => r.id === id);
    if (repo && Array.isArray(repo.notes)) {
      repo.notes = repo.notes.filter((n) => n.timestamp !== timestamp);
      this.save();
    }
  }

  setAlias(id: string, alias: string): void {
    const repo = this.data.repos.find((r) => r.id === id);
    if (repo) {
      repo.alias = alias;
      this.save();
    }
  }

  // ── Persistence ───────────────────────────────────────

  private load(): OrbitalData {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        return JSON.parse(raw) as OrbitalData;
      }
    } catch {
      // Corrupt file — start fresh
    }
    return defaultData();
  }

  private save(): void {
    try {
      if (!fs.existsSync(ORBITAL_DIR)) {
        fs.mkdirSync(ORBITAL_DIR, { recursive: true });
      }
      // Atomic write: write to temp, then rename
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmp, DATA_FILE);
    } catch (err) {
      console.error('Orbital: Failed to save data', err);
    }
  }

  /** Force re-read from disk (useful if edited externally) */
  reload(): void {
    this.data = this.load();
  }
}
