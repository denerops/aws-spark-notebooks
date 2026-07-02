import * as vscode from 'vscode';
import { getGlueSessionService } from '../glue/glueSessionService';
import { formatAwsAuthError } from '../aws/credentials';
import type { GlueConnectionManager } from '../glue/connectionManager';
import { formatGlueSessionLabel, type GlueSessionSummary } from '../glue/types';

export const GLUE_SESSIONS_VIEW_ID = 'glueInteractiveSessions';

export type GlueTreeNodeKind =
  | 'session'
  | 'sessionReady'
  | 'sessionProvisioning'
  | 'sessionStopped'
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
    case 'FAILED':
    case 'TIMEOUT':
    case 'STOPPING':
      return 'sessionStopped';
    default:
      return 'session';
  }
}

export class GlueSessionsTreeProvider implements vscode.TreeDataProvider<GlueSessionsTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<GlueSessionsTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sessions: GlueSessionSummary[] = [];
  private region = '';
  private loadError: string | undefined;
  private loading = false;

  constructor(private readonly connectionManager: GlueConnectionManager) {}

  refresh(): void {
    void this.loadSessions();
    this._onDidChangeTreeData.fire(undefined);
  }

  async loadSessions(): Promise<void> {
    this.loading = true;
    this.loadError = undefined;
    try {
      const service = getGlueSessionService();
      this.region = await service.getRegion();
      this.sessions = await service.listLivySessions();
    } catch (error) {
      this.loadError = formatAwsAuthError(error);
      this.sessions = [];
    } finally {
      this.loading = false;
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  getTreeItem(element: GlueSessionsTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: GlueSessionsTreeItem): Promise<GlueSessionsTreeItem[]> {
    if (element) {
      return [];
    }

    if (this.loading && this.sessions.length === 0 && !this.loadError) {
      return [
        new GlueSessionsTreeItem(
          'loading',
          { region: this.region },
          'Loading Glue sessions…',
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    }

    if (this.loadError) {
      return [
        new GlueSessionsTreeItem(
          'error',
          { region: this.region },
          'Failed to load',
          vscode.TreeItemCollapsibleState.None,
          { description: this.loadError, tooltip: this.loadError }
        ),
      ];
    }

    const items: GlueSessionsTreeItem[] = this.sessions.map((session) =>
      new GlueSessionsTreeItem(
        kindForStatus(session.status),
        {
          sessionId: session.id,
          sessionStatus: session.status,
          region: this.region,
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
          ]
            .filter(Boolean)
            .join('\n'),
        }
      )
    );

    if (this.connectionManager.isCreatingSession()) {
      items.push(
        new GlueSessionsTreeItem(
          'loading',
          { region: this.region },
          'Creating session…',
          vscode.TreeItemCollapsibleState.None,
          { description: 'Please wait' }
        )
      );
    } else {
      items.push(
        new GlueSessionsTreeItem(
          'empty',
          { region: this.region },
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
          { region: this.region },
          'No active Glue Livy sessions',
          vscode.TreeItemCollapsibleState.None,
          {
            description: this.region,
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
  connectionManager: GlueConnectionManager
): GlueSessionsTreeProvider {
  const provider = new GlueSessionsTreeProvider(connectionManager);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(GLUE_SESSIONS_VIEW_ID, provider)
  );

  void provider.loadSessions();

  return provider;
}
