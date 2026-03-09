import * as vscode from 'vscode';
import * as path from 'path';
import { DataStore } from '../data/dataStore';
import { GitService } from '../git/gitService';
import { RepoTreeProvider } from '../views/treeView/repoTreeProvider';
import { DashboardProvider } from '../views/webview/dashboardProvider';
import { DiffPaneProvider } from '../views/webview/diffPaneProvider';

export function registerCommands(
  context: vscode.ExtensionContext,
  dataStore: DataStore,
  gitService: GitService,
  treeProvider: RepoTreeProvider,
  dashboardProvider: DashboardProvider,
  diffPaneProvider: DiffPaneProvider
): void {
  context.subscriptions.push(
    // ── Add Repository ────────────────────────────────
    vscode.commands.registerCommand('orbital.addRepo', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: true,
        openLabel: 'Add to Orbital',
      });
      if (!uris || uris.length === 0) {return;}

      for (const uri of uris) {
        const repoPath = uri.fsPath;
        // Verify it's a git repo
        try {
          await gitService.getStatus(repoPath);
          dataStore.addRepo(repoPath);
        } catch {
          vscode.window.showWarningMessage(
            `"${path.basename(repoPath)}" does not appear to be a git repository.`
          );
        }
      }
      treeProvider.refresh();
      dashboardProvider.refresh();
    }),

    // ── Remove Repository ─────────────────────────────
    vscode.commands.registerCommand('orbital.removeRepo', async (item?: { repoId?: string }) => {
      let repoId = item?.repoId;

      if (!repoId) {
        const repos = dataStore.getRepos();
        if (repos.length === 0) {
          vscode.window.showInformationMessage('No repositories tracked by Orbital.');
          return;
        }
        const pick = await vscode.window.showQuickPick(
          repos.map((r) => ({ label: r.alias || path.basename(r.path), description: r.path, id: r.id })),
          { placeHolder: 'Select repository to remove' }
        );
        if (!pick) {return;}
        repoId = pick.id;
      }

      dataStore.removeRepo(repoId);
      treeProvider.refresh();
      dashboardProvider.refresh();
    }),

    // ── Edit Notes ────────────────────────────────────
    vscode.commands.registerCommand('orbital.editNotes', async (item?: { repoId?: string }) => {
      const repoId = await resolveRepoId(item?.repoId, dataStore);
      if (!repoId) {return;}

      const repo = dataStore.getRepo(repoId);
      if (!repo) {return;}

      const notes = await vscode.window.showInputBox({
        prompt: `Add note for ${repo.alias || path.basename(repo.path)}`,
        placeHolder: 'Type a note and press Enter...',
      });
      if (!notes) {return;} // cancelled or empty

      dataStore.addNote(repoId, notes);
      treeProvider.refresh();
      dashboardProvider.refresh();
    }),

    // ── Refresh All ───────────────────────────────────
    vscode.commands.registerCommand('orbital.refresh', () => {
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Orbital: Refreshing...', cancellable: false },
        async () => {
          treeProvider.refresh();
          await dashboardProvider.refresh();
        }
      );
    }),

    // ── Open Dashboard ────────────────────────────────
    vscode.commands.registerCommand('orbital.openDashboard', () => {
      dashboardProvider.open();
    }),

    // ── Open Repo Folder ──────────────────────────────
    vscode.commands.registerCommand('orbital.openRepoFolder', async (item?: { repoId?: string }) => {
      const repoId = await resolveRepoId(item?.repoId, dataStore);
      if (!repoId) {return;}
      const repo = dataStore.getRepo(repoId);
      if (!repo) {return;}
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(repo.path), true);
    }),

    // ── Open Terminal ─────────────────────────────────
    vscode.commands.registerCommand('orbital.openRepoTerminal', async (item?: { repoId?: string }) => {
      const repoId = await resolveRepoId(item?.repoId, dataStore);
      if (!repoId) {return;}
      const repo = dataStore.getRepo(repoId);
      if (!repo) {return;}
      const terminal = vscode.window.createTerminal({
        name: `Orbital: ${repo.alias || path.basename(repo.path)}`,
        cwd: repo.path,
      });
      terminal.show();
    }),

    // ── Set Alias ─────────────────────────────────────
    vscode.commands.registerCommand('orbital.setAlias', async (item?: { repoId?: string }) => {
      const repoId = await resolveRepoId(item?.repoId, dataStore);
      if (!repoId) {return;}
      const repo = dataStore.getRepo(repoId);
      if (!repo) {return;}

      const alias = await vscode.window.showInputBox({
        prompt: `Alias for ${path.basename(repo.path)}`,
        value: repo.alias || '',
        placeHolder: 'Enter a friendly name...',
      });
      if (alias === undefined) {return;}

      dataStore.setAlias(repoId, alias);
      treeProvider.refresh();
      dashboardProvider.refresh();
    }),

    // ── Clear All Notes ──────────────────────────────
    vscode.commands.registerCommand('orbital.clearNotes', async (item?: { repoId?: string }) => {
      const repoId = await resolveRepoId(item?.repoId, dataStore);
      if (!repoId) {return;}
      const repo = dataStore.getRepo(repoId);
      if (!repo) {return;}

      const confirm = await vscode.window.showWarningMessage(
        `Clear all notes for "${repo.alias || path.basename(repo.path)}"?`,
        { modal: true },
        'Clear All Notes'
      );
      if (confirm !== 'Clear All Notes') {return;}

      dataStore.clearNotes(repoId);
      treeProvider.refresh();
      dashboardProvider.refresh();
    }),

    // ── Archive Notes ────────────────────────────────
    vscode.commands.registerCommand('orbital.archiveNotes', async (item?: { repoId?: string }) => {
      const repoId = await resolveRepoId(item?.repoId, dataStore);
      if (!repoId) {return;}
      const repo = dataStore.getRepo(repoId);
      if (!repo) {return;}

      if (!repo.notes || repo.notes.length === 0) {
        vscode.window.showInformationMessage('No notes to archive.');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Archive ${repo.notes.length} note(s) for "${repo.alias || path.basename(repo.path)}"? Notes will be saved to ~/.orbital/archives/ and cleared.`,
        { modal: true },
        'Archive Notes'
      );
      if (confirm !== 'Archive Notes') {return;}

      const archiveFile = dataStore.archiveNotes(repoId);
      if (archiveFile) {
        vscode.window.showInformationMessage(`Notes archived to ${archiveFile}`);
      }
      treeProvider.refresh();
      dashboardProvider.refresh();
    }),

    // ── View Diff vs Main ────────────────────────────
    vscode.commands.registerCommand('orbital.viewDiff', async (item?: { repoId?: string }) => {
      const repoId = await resolveRepoId(item?.repoId, dataStore);
      if (!repoId) {return;}
      const repo = dataStore.getRepo(repoId);
      if (!repo) {return;}
      const repoName = repo.alias || path.basename(repo.path);
      await diffPaneProvider.open(repo.path, repoName);
    }),

    // ── Change Base Branch ───────────────────────────
    vscode.commands.registerCommand('orbital.changeBaseBranch', async (item?: { repoId?: string }) => {
      const repoId = await resolveRepoId(item?.repoId, dataStore);
      if (!repoId) {return;}
      const repo = dataStore.getRepo(repoId);
      if (!repo) {return;}

      let branches: string[];
      try {
        branches = await gitService.listBranches(repo.path);
      } catch {
        vscode.window.showErrorMessage('Failed to list branches.');
        return;
      }

      const currentBase = repo.baseBranch || await gitService.getDefaultBranch(repo.path);

      // Build pick items: auto-detect first, then all branches
      const pickLabels: string[] = [
        !repo.baseBranch ? '✓ Auto-detect (main/master)' : 'Auto-detect (main/master)',
        ...branches.map((b) => b === currentBase ? `✓ ${b}` : b),
      ];

      const pick = await vscode.window.showQuickPick(pickLabels, {
        placeHolder: `Base branch for diffs — currently: ${currentBase}`,
      });
      if (!pick) {return;}

      // Parse selection
      const selected = pick.replace(/^✓ /, '');
      if (selected.startsWith('Auto-detect')) {
        dataStore.setBaseBranch(repoId, undefined);
      } else {
        dataStore.setBaseBranch(repoId, selected);
      }
      treeProvider.refresh();
      dashboardProvider.refresh();
    }),

    // ── Open File Diff (native VS Code diff editor) ──
    vscode.commands.registerCommand('orbital.openFileDiff', async (
      repoPath: string,
      filePath: string,
      baseBranch: string,
      gitServiceRef: GitService
    ) => {
      const absolutePath = path.join(repoPath, filePath);
      const fileName = path.basename(filePath);
      const safeBranch = baseBranch.replace(/[/\\:*?"<>|]/g, '_');
      const safeFilePath = filePath.replace(/[/\\]/g, '_');
      const tmpDir = path.join(require('os').tmpdir(), 'orbital-diff');
      const fs = require('fs');
      if (!fs.existsSync(tmpDir)) { fs.mkdirSync(tmpDir, { recursive: true }); }

      // Left: file at base branch
      let leftUri: vscode.Uri;
      try {
        const baseContent = await gitServiceRef.getFileAtRef(repoPath, baseBranch, filePath);
        const tmpFile = path.join(tmpDir, `${safeBranch}__${safeFilePath}`);
        fs.writeFileSync(tmpFile, baseContent, 'utf-8');
        leftUri = vscode.Uri.file(tmpFile);
      } catch {
        const tmpFile = path.join(tmpDir, `${safeBranch}__${safeFilePath}`);
        fs.writeFileSync(tmpFile, '', 'utf-8');
        leftUri = vscode.Uri.file(tmpFile);
      }

      // Right: working tree
      const rightUri = vscode.Uri.file(absolutePath);
      const label = `${fileName} (${baseBranch} ↔ working tree)`;
      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, label);
    })
  );
}

/** Helper: resolve a repo ID from a tree item or via quick-pick */
async function resolveRepoId(
  fromItem: string | undefined,
  dataStore: DataStore
): Promise<string | undefined> {
  if (fromItem) {return fromItem;}

  const repos = dataStore.getRepos();
  if (repos.length === 0) {
    vscode.window.showInformationMessage('No repositories tracked by Orbital.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    repos.map((r) => ({
      label: r.alias || path.basename(r.path),
      description: r.path,
      id: r.id,
    })),
    { placeHolder: 'Select a repository' }
  );
  return pick?.id;
}
