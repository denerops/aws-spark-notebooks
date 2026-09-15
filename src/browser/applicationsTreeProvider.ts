import * as vscode from 'vscode';
import { formatLivySessionLabel, type LivySessionInfo } from '../livy/types';
import type { SessionStartupFailure } from '../session/diagnoseStartupFailure';
import { STARTING_SESSION_STATES } from '../session/sessionState';
import type { EmrSessionCatalog } from '../platform/sessionCatalog';
import type { LivyApplication } from '../aws/emrServerlessClient';

export const APPLICATIONS_VIEW_ID = 'emrServerlessApplications';

export type AppTreeNodeKind =
  | 'region'
  | 'application'
  | 'applicationStopped'
  | 'applicationStarting'
  | 'applicationStopping'
  | 'applicationRunning'
  | 'session'
  | 'sessionStarting'
  | 'sessionDead'
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
    case 'applicationStarting':
    case 'applicationStopping':
    case 'sessionStarting':
      return new vscode.ThemeIcon('loading~spin');
    case 'applicationStopped':
      return new vscode.ThemeIcon('debug-disconnect');
    case 'session':
      return new vscode.ThemeIcon('symbol-method');
    case 'sessionDead':
      return new vscode.ThemeIcon('error');
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

function kindForApplicationState(state: string): AppTreeNodeKind {
  switch (state) {
    case 'STARTED':
      return 'applicationRunning';
    case 'STARTING':
      return 'applicationStarting';
    case 'STOPPING':
      return 'applicationStopping';
    case 'STOPPED':
    case 'CREATED':
    default:
      return 'applicationStopped';
  }
}

const SESSION_DEAD_STATES = new Set(['dead', 'error', 'killed', 'shutting_down']);

function kindForSessionState(state: string): AppTreeNodeKind {
  if (STARTING_SESSION_STATES.has(state)) {
    return 'sessionStarting';
  }
  if (SESSION_DEAD_STATES.has(state)) {
    return 'sessionDead';
  }
  return 'session';
}

export class ApplicationsTreeProvider implements vscode.TreeDataProvider<ApplicationsTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ApplicationsTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly catalog: EmrSessionCatalog) {
    catalog.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  refresh(): void {
    void this.catalog.refresh();
  }

  patchApplicationState(applicationId: string, state: string): void {
    this.catalog.patchApplicationState(applicationId, state);
  }

  markSessionCreating(applicationId: string, sessionName?: string): void {
    this.catalog.markSessionCreating(applicationId, sessionName);
  }

  upsertSession(applicationId: string, session: LivySessionInfo): void {
    this.catalog.upsertSession(applicationId, session);
  }

  recordStartupFailure(applicationId: string, failure: SessionStartupFailure): void {
    this.catalog.recordStartupFailure(applicationId, failure);
  }

  getSessionFailure(
    applicationId: string,
    sessionId: number
  ): SessionStartupFailure | undefined {
    return this.catalog.getSessionFailure(applicationId, sessionId);
  }

  clearSessionCreating(applicationId: string): void {
    this.catalog.clearSessionCreating(applicationId);
  }

  async loadApplications(): Promise<void> {
    await this.catalog.refresh();
  }

  getTreeItem(element: ApplicationsTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ApplicationsTreeItem): Promise<ApplicationsTreeItem[]> {
    const region = this.catalog.region;
    const applications = this.catalog.applications;
    const loadError = this.catalog.loadError;
    const loading = this.catalog.loading;

    if (!element) {
      if (loading && applications.length === 0 && !loadError) {
        return [
          new ApplicationsTreeItem(
            'loading',
            { region },
            'Loading applications…',
            vscode.TreeItemCollapsibleState.None
          ),
        ];
      }

      if (loadError) {
        return [
          new ApplicationsTreeItem(
            'error',
            { region },
            'Failed to load',
            vscode.TreeItemCollapsibleState.None,
            { description: loadError, tooltip: loadError }
          ),
        ];
      }

      if (applications.length === 0) {
        return [
          new ApplicationsTreeItem(
            'empty',
            { region },
            'No Livy-enabled applications',
            vscode.TreeItemCollapsibleState.None,
            { description: region }
          ),
        ];
      }

      return applications.map((app) => {
        const kind = kindForApplicationState(app.state);
        const running = kind === 'applicationRunning';
        const sessionCount = this.catalog.sessionsFor(app.id).length;
        const description = running ? `${app.state} · ${sessionCount} session(s)` : app.state;
        return new ApplicationsTreeItem(
          kind,
          { applicationId: app.id, applicationName: app.name, region },
          app.name,
          running
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
          {
            description,
            tooltip: `${app.name} (${app.id})\nState: ${app.state}\n${app.releaseLabel ?? ''}`,
          }
        );
      });
    }

    if (element.kind === 'region') {
      return [];
    }

    if (element.kind === 'applicationRunning' && element.context.applicationId) {
      const sessions = this.catalog.sessionsFor(element.context.applicationId);
      const items: ApplicationsTreeItem[] = sessions.map((session) => {
        const kind = kindForSessionState(session.state);
        const failure = this.catalog.getSessionFailure(
          element.context.applicationId!,
          session.id
        );
        return new ApplicationsTreeItem(
          kind,
          {
            applicationId: element.context.applicationId,
            applicationName: element.context.applicationName,
            sessionId: session.id,
            sessionState: session.state,
            region,
          },
          formatLivySessionLabel(session),
          vscode.TreeItemCollapsibleState.None,
          {
            description: `${session.state} · ${session.kind ?? 'pyspark'}`,
            tooltip: formatSessionTooltip(session, failure),
          }
        );
      });

      const appId = element.context.applicationId;
      if (this.catalog.pendingSessionCreate.has(appId)) {
        const pendingName = this.catalog.pendingSessionCreate.get(appId);
        const label = pendingName?.trim()
          ? `Creating "${pendingName}"…`
          : 'Creating session…';
        items.push(
          new ApplicationsTreeItem(
            'loading',
            element.context,
            label,
            vscode.TreeItemCollapsibleState.None,
            { description: 'starting' }
          )
        );
      } else if (!this.catalog.isCreatingSession(appId)) {
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
    return this.catalog.getApplication(applicationId);
  }
}

function formatSessionTooltip(
  session: LivySessionInfo,
  failure?: SessionStartupFailure
): string {
  return [
    `Session ${session.id}`,
    session.name ? `Name: ${session.name}` : undefined,
    `Owner: ${session.owner ?? 'unknown'}`,
    `State: ${session.state}`,
    failure?.summary,
  ]
    .filter(Boolean)
    .join('\n');
}

export function registerApplicationsTree(
  context: vscode.ExtensionContext,
  catalog: EmrSessionCatalog
): ApplicationsTreeProvider {
  const provider = new ApplicationsTreeProvider(catalog);

  const view = vscode.window.createTreeView(APPLICATIONS_VIEW_ID, {
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
