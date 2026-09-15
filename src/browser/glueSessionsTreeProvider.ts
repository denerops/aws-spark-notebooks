import * as vscode from 'vscode';
import { formatGlueSessionLabel } from '../glue/types';
import type { GlueSessionCatalog } from '../platform/sessionCatalog';

export const GLUE_SESSIONS_VIEW_ID = 'glueInteractiveSessions';

export type GlueTreeNodeKind =
  | 'session'
  | 'sessionReady'
  | 'sessionProvisioning'
  | 'sessionStopped'
  | 'sessionFailed'
  | 'loading'
  | 'error'
  | 'empty';

export interface GlueTreeContext {
  sessionId?: string;
  sessionStatus?: string;
  region?: string;
}

export class GlueSessionsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly kind: GlueTreeNodeKind,
    public readonly context: GlueTreeContext,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options?: {
      description?: string;
      tooltip?: string;
      command?: vscode.Command;
      iconPath?: vscode.ThemeIcon;
    }
  ) {
    super(label, collapsibleState);
    this.description = options?.description;
    this.tooltip = options?.tooltip ?? label;
    this.command = options?.command;
    this.iconPath = options?.iconPath ?? iconForKind(kind);
    this.contextValue = kind;
  }
}

function iconForKind(kind: GlueTreeNodeKind): vscode.ThemeIcon {
  switch (kind) {
    case 'sessionReady':
      return new vscode.ThemeIcon('symbol-method');
    case 'sessionProvisioning':
      return new vscode.ThemeIcon('loading~spin');
    case 'sessionStopped':
      return new vscode.ThemeIcon('debug-disconnect');
    case 'sessionFailed':
      return new vscode.ThemeIcon('error');
    case 'loading':
      return new vscode.ThemeIcon('loading~spin');
    case 'error':
      return new vscode.ThemeIcon('error');
    default:
      return new vscode.ThemeIcon('info');
  }
}

function kindForStatus(status: string): GlueTreeNodeKind {
  switch (status) {
    case 'READY':
      return 'sessionReady';
    case 'PROVISIONING':
      return 'sessionProvisioning';
    case 'STOPPED':
    case 'STOPPING':
      return 'sessionStopped';
    case 'FAILED':
    case 'TIMEOUT':
      return 'sessionFailed';
    default:
      return 'session';
  }
}

export class GlueSessionsTreeProvider implements vscode.TreeDataProvider<GlueSessionsTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<GlueSessionsTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly catalog: GlueSessionCatalog) {
    catalog.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  refresh(): void {
    void this.catalog.refresh();
  }

  async loadSessions(): Promise<void> {
    await this.catalog.refresh();
  }

  getTreeItem(element: GlueSessionsTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: GlueSessionsTreeItem): Promise<GlueSessionsTreeItem[]> {
    if (element) {
      return [];
    }

    const region = this.catalog.region;
    const sessions = this.catalog.sessions;
    const loadError = this.catalog.loadError;
    const loading = this.catalog.loading;

    if (loading && sessions.length === 0 && !loadError) {
      return [
        new GlueSessionsTreeItem(
          'loading',
          { region },
          'Loading Glue sessions…',
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    }

    if (loadError) {
      return [
        new GlueSessionsTreeItem(
          'error',
          { region },
          'Failed to load',
          vscode.TreeItemCollapsibleState.None,
          { description: loadError, tooltip: loadError }
        ),
      ];
    }

    const items: GlueSessionsTreeItem[] = sessions.map(
      (session) =>
        new GlueSessionsTreeItem(
          kindForStatus(session.status),
          {
            sessionId: session.id,
            sessionStatus: session.status,
            region,
          },
          formatGlueSessionLabel(session),
          vscode.TreeItemCollapsibleState.None,
          {
            description: `${session.status} · ${session.workerType ?? '?'} · ${session.numberOfWorkers ?? '?'} workers`,
            tooltip: [
              session.id,
              session.description ? `Description: ${session.description}` : undefined,
              session.glueVersion ? `Glue ${session.glueVersion}` : undefined,
              session.role ? `Role: ${session.role}` : undefined,
              session.errorMessage ? session.errorMessage : undefined,
            ]
              .filter(Boolean)
              .join('\n'),
          }
        )
    );

    if (this.catalog.isCreatingSession()) {
      items.push(
        new GlueSessionsTreeItem(
          'loading',
          { region },
          'Creating session…',
          vscode.TreeItemCollapsibleState.None,
          { description: 'Please wait' }
        )
      );
    } else {
      items.push(
        new GlueSessionsTreeItem(
          'empty',
          { region },
          'New session…',
          vscode.TreeItemCollapsibleState.None,
          {
            command: {
              command: 'glueInteractive.newSession',
              title: 'New Glue Session',
            },
          }
        )
      );
    }

    if (items.length === 1 && items[0].kind === 'empty') {
      return [
        new GlueSessionsTreeItem(
          'empty',
          { region },
          'No active Glue Livy sessions',
          vscode.TreeItemCollapsibleState.None,
          {
            description: region,
            command: {
              command: 'glueInteractive.newSession',
              title: 'New Glue Session',
            },
          }
        ),
      ];
    }

    return items;
  }
}

export function registerGlueSessionsTree(
  context: vscode.ExtensionContext,
  catalog: GlueSessionCatalog
): GlueSessionsTreeProvider {
  const provider = new GlueSessionsTreeProvider(catalog);

  const view = vscode.window.createTreeView(GLUE_SESSIONS_VIEW_ID, {
    treeDataProvider: provider,
  });
  context.subscriptions.push(
    view,
    { dispose: () => catalog.dispose() },
    view.onDidChangeVisibility((event) => catalog.setViewVisible(event.visible))
  );
  if (view.visible) {
    catalog.setViewVisible(true);
  }

  void catalog.refresh();

  return provider;
}
