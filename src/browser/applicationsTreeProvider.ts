import * as vscode from 'vscode';
import { getEmrServerlessService, type LivyApplication } from '../aws/emrServerlessClient';
import type { ConnectionManager } from '../emr/connectionManager';
import { formatLivySessionLabel, type LivySessionInfo } from '../livy/types';
import { LivySigV4Client } from '../livy/sigV4Client';

export const APPLICATIONS_VIEW_ID = 'emrServerlessApplications';

export type AppTreeNodeKind =
  | 'region'
  | 'application'
  | 'applicationStopped'
  | 'applicationRunning'
  | 'session'
  | 'loading'
  | 'error'
  | 'empty';

export interface AppTreeContext {
  applicationId?: string;
  applicationName?: string;
  sessionId?: number;
  sessionState?: string;
  region?: string;
}

export class ApplicationsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly kind: AppTreeNodeKind,
    public readonly context: AppTreeContext,
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

function iconForKind(kind: AppTreeNodeKind): vscode.ThemeIcon {
  switch (kind) {
    case 'application':
    case 'applicationRunning':
      return new vscode.ThemeIcon('server-environment');
    case 'applicationStopped':
      return new vscode.ThemeIcon('debug-disconnect');
    case 'session':
      return new vscode.ThemeIcon('symbol-method');
    case 'loading':
      return new vscode.ThemeIcon('loading~spin');
    case 'error':
      return new vscode.ThemeIcon('error');
    case 'region':
      return new vscode.ThemeIcon('cloud');
    default:
      return new vscode.ThemeIcon('info');
  }
}

export class ApplicationsTreeProvider implements vscode.TreeDataProvider<ApplicationsTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ApplicationsTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private applications: LivyApplication[] = [];
  private sessionsByApp = new Map<string, LivySessionInfo[]>();
  private region = '';
  private loadError: string | undefined;
  private loading = false;

  constructor(private readonly connectionManager: ConnectionManager) {}

  refresh(): void {
    void this.loadApplications();
    this._onDidChangeTreeData.fire(undefined);
  }

  async loadApplications(): Promise<void> {
    this.loading = true;
    this.loadError = undefined;
    try {
      const service = getEmrServerlessService();
      this.region = await service.getRegion();
      this.applications = await service.listLivyApplications();
      this.sessionsByApp.clear();

      for (const app of this.applications) {
        if (app.state === 'STARTED') {
          try {
            const client = new LivySigV4Client(app.id, this.region);
            const sessions = await client.listSessions();
            this.sessionsByApp.set(app.id, sessions);
          } catch {
            this.sessionsByApp.set(app.id, []);
          }
        }
      }
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : String(error);
      this.applications = [];
    } finally {
      this.loading = false;
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  getTreeItem(element: ApplicationsTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ApplicationsTreeItem): Promise<ApplicationsTreeItem[]> {
    if (!element) {
      if (this.loading && this.applications.length === 0 && !this.loadError) {
        return [
          new ApplicationsTreeItem(
            'loading',
            { region: this.region },
            'Loading applications…',
            vscode.TreeItemCollapsibleState.None
          ),
        ];
      }

      if (this.loadError) {
        return [
          new ApplicationsTreeItem(
            'error',
            { region: this.region },
            'Failed to load',
            vscode.TreeItemCollapsibleState.None,
            { description: this.loadError, tooltip: this.loadError }
          ),
        ];
      }

      if (this.applications.length === 0) {
        return [
          new ApplicationsTreeItem(
            'empty',
            { region: this.region },
            'No Livy-enabled applications',
            vscode.TreeItemCollapsibleState.None,
            { description: this.region }
          ),
        ];
      }

      return [
        new ApplicationsTreeItem(
          'region',
          { region: this.region },
          `Region: ${this.region}`,
          vscode.TreeItemCollapsibleState.Expanded
        ),
      ];
    }

    if (element.kind === 'region') {
      return this.applications.map((app) => {
        const running = app.state === 'STARTED';
        const sessionCount = this.sessionsByApp.get(app.id)?.length ?? 0;
        return new ApplicationsTreeItem(
          running ? 'applicationRunning' : 'applicationStopped',
          { applicationId: app.id, applicationName: app.name, region: this.region },
          app.name,
          running
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
          {
            description: `${app.state}${running ? ` · ${sessionCount} session(s)` : ''}`,
            tooltip: `${app.name} (${app.id})\n${app.releaseLabel ?? ''}`,
          }
        );
      });
    }

    if (
      element.kind === 'applicationRunning' &&
      element.context.applicationId
    ) {
      const sessions = this.sessionsByApp.get(element.context.applicationId) ?? [];
      const items: ApplicationsTreeItem[] = sessions.map((session) =>
        new ApplicationsTreeItem(
          'session',
          {
            applicationId: element.context.applicationId,
            applicationName: element.context.applicationName,
            sessionId: session.id,
            sessionState: session.state,
            region: this.region,
          },
          formatLivySessionLabel(session),
          vscode.TreeItemCollapsibleState.None,
          {
            description: `${session.state} · ${session.kind ?? 'pyspark'}`,
            tooltip: `Session ${session.id}${session.name ? `\nName: ${session.name}` : ''}\nOwner: ${session.owner ?? 'unknown'}`,
          }
        )
      );

      const appId = element.context.applicationId!;
      if (this.connectionManager.isCreatingSession(appId)) {
        items.push(
          new ApplicationsTreeItem(
            'loading',
            element.context,
            'Creating session…',
            vscode.TreeItemCollapsibleState.None,
            { description: 'Please wait' }
          )
        );
      } else {
        items.push(
          new ApplicationsTreeItem(
            'empty',
            element.context,
            'New session…',
            vscode.TreeItemCollapsibleState.None,
            {
              command: {
                command: 'emrServerless.newSession',
                title: 'New Session',
                arguments: [element],
              },
            }
          )
        );
      }

      return items;
    }

    return [];
  }

  getApplication(applicationId: string): LivyApplication | undefined {
    return this.applications.find((a) => a.id === applicationId);
  }
}

export function registerApplicationsTree(
  context: vscode.ExtensionContext,
  connectionManager: ConnectionManager
): ApplicationsTreeProvider {
  const provider = new ApplicationsTreeProvider(connectionManager);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(APPLICATIONS_VIEW_ID, provider)
  );

  void provider.loadApplications();

  return provider;
}
