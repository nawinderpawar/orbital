import * as vscode from 'vscode';
import * as path from 'path';
import { DataStore } from '../data/dataStore';
import { GitService } from '../git/gitService';
import { RepoTreeProvider } from '../views/treeView/repoTreeProvider';
import { DashboardProvider } from '../views/webview/dashboardProvider';

export function registerCommands(
  context: vscode.ExtensionContext,
  dataStore: DataStore,
  gitService: GitService,
  treeProvider: RepoTreeProvider,
  dashboardProvider: DashboardProvider
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
      treeProvider.refresh();
      dashboardProvider.refresh();
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
