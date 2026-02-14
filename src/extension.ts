import * as vscode from 'vscode';
import { DataStore } from './data/dataStore';
import { GitService } from './git/gitService';
import { RepoTreeProvider } from './views/treeView/repoTreeProvider';
import { DashboardProvider } from './views/webview/dashboardProvider';
import { PollService } from './services/pollService';
import { registerCommands } from './commands/commands';

let pollService: PollService | undefined;

export function activate(context: vscode.ExtensionContext) {
  const dataStore = new DataStore();
  const gitService = new GitService();
  const treeProvider = new RepoTreeProvider(dataStore, gitService);
  const dashboardProvider = new DashboardProvider(context.extensionUri, dataStore, gitService);

  // Register the TreeView
  const treeView = vscode.window.createTreeView('orbital.repoTree', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Register all commands
  registerCommands(context, dataStore, gitService, treeProvider, dashboardProvider);

  // Start polling
  const config = vscode.workspace.getConfiguration('orbital');
  const intervalSec = config.get<number>('pollIntervalSeconds', 30);
  pollService = new PollService(gitService, dataStore, intervalSec * 1000, () => {
    treeProvider.refresh();
    dashboardProvider.refresh();
  });
  pollService.start();

  // React to config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('orbital.pollIntervalSeconds')) {
        const newInterval = vscode.workspace
          .getConfiguration('orbital')
          .get<number>('pollIntervalSeconds', 30);
        pollService?.setInterval(newInterval * 1000);
      }
    })
  );

  context.subscriptions.push(treeView);
}

export function deactivate() {
  pollService?.stop();
}
