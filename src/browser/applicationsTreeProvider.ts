import * as vscode from 'vscode';
import type { LivyApplication } from '../aws/emrServerlessClient';
import { formatAwsAuthError } from '../aws/credentials';
import type { EmrSparkBackend } from '../emr/connectionManager';
import { formatLivySessionLabel, type LivySessionInfo } from '../livy/types';
import {
  diagnoseLivyStartupFailure,
  type SessionStartupFailure,
} from '../session/diagnoseStartupFailure';

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

const SESSION_STARTING_STATES = new Set(['not_started', 'starting', 'recovering']);
const SESSION_DEAD_STATES = new Set(['dead', 'error', 'killed', 'shutting_down']);

function kindForSessionState(state: string): AppTreeNodeKind {
  if (SESSION_STARTING_STATES.has(state)) {
    return 'sessionStarting';
  }
  if (SESSION_DEAD_STATES.has(state)) {
    return 'sessionDead';
  }
  return 'session';
}

function sessionFailureKey(applicationId: string, sessionId: number): string {
  return `${applicationId}:${sessionId}`;
}

export class ApplicationsTreeProvider implements vscode.TreeDataProvider<ApplicationsTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ApplicationsTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private applications: LivyApplication[] = [];
  private sessionsByApp = new Map<string, LivySessionInfo[]>();
  /** Apps with a session create in flight before Livy returns a session id. */
  private readonly pendingSessionCreate = new Map<string, string | undefined>();
  private readonly sessionFailures = new Map<string, SessionStartupFailure>();
  private region = '';
  private loadError: string | undefined;
  private loading = false;

  constructor(private readonly emrBackend: EmrSparkBackend) {}

  refresh(): void {
    void this.loadApplications();
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Optimistically update a single app's state in the sidebar (e.g. STARTING / STOPPING). */
  patchApplicationState(applicationId: string, state: string): void {
    const index = this.applications.findIndex((app) => app.id === applicationId);
    if (index < 0) {
      return;
    }
    this.applications[index] = { ...this.applications[index], state };
    if (state !== 'STARTED') {
      this.sessionsByApp.delete(applicationId);
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Show a "Creating session…" row under the app until Livy assigns a session id. */
  markSessionCreating(applicationId: string, sessionName?: string): void {
    this.pendingSessionCreate.set(applicationId, sessionName);
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Insert or update a session row as creation progresses (starting → idle). */
  upsertSession(applicationId: string, session: LivySessionInfo): void {
    this.pendingSessionCreate.delete(applicationId);
    const existing = this.sessionsByApp.get(applicationId) ?? [];
    const index = existing.findIndex((s) => s.id === session.id);
    const next = [...existing];
    if (index >= 0) {
      next[index] = { ...next[index], ...session };
    } else {
      next.push(session);
    }
    this.sessionsByApp.set(applicationId, next);
    this.maybeRecordFailureFromSession(applicationId, next[index >= 0 ? index : next.length - 1]!);
    this._onDidChangeTreeData.fire(undefined);
  }

  recordStartupFailure(applicationId: string, failure: SessionStartupFailure): void {
    const sessionId = failure.sessionId;
    if (typeof sessionId !== 'number') {
      return;
    }
    this.sessionFailures.set(sessionFailureKey(applicationId, sessionId), failure);
    this._onDidChangeTreeData.fire(undefined);
  }

  getSessionFailure(
    applicationId: string,
    sessionId: number
  ): SessionStartupFailure | undefined {
    return this.sessionFailures.get(sessionFailureKey(applicationId, sessionId));
  }

  private maybeRecordFailureFromSession(applicationId: string, session: LivySessionInfo): void {
    if (!SESSION_DEAD_STATES.has(session.state)) {
      return;
    }
    const key = sessionFailureKey(applicationId, session.id);
    const existing = this.sessionFailures.get(key);
    if (existing && existing.logLines.length > 0) {
      return;
    }
    if (!session.log?.length && existing) {
      return;
    }
    this.sessionFailures.set(
      key,
      diagnoseLivyStartupFailure({
        state: session.state,
        logLines: session.log,
        sessionId: session.id,
      })
    );
  }

  private pruneSessionFailures(): void {
    const alive = new Set<string>();
    for (const [appId, sessions] of this.sessionsByApp) {
      for (const session of sessions) {
        alive.add(sessionFailureKey(appId, session.id));
      }
    }
    for (const key of [...this.sessionFailures.keys()]) {
      if (!alive.has(key)) {
        this.sessionFailures.delete(key);
      }
    }
  }

  clearSessionCreating(applicationId: string): void {
    this.pendingSessionCreate.delete(applicationId);
    this._onDidChangeTreeData.fire(undefined);
  }

  async loadApplications(): Promise<void> {
    this.loading = true;
    this.loadError = undefined;
    try {
      const { region, applications } = await this.emrBackend.listApplications();
      this.region = region;
      this.applications = applications;
      this.sessionsByApp.clear();
      // Keep pendingSessionCreate — an in-flight create should still show in the tree.

      for (const app of this.applications) {
        if (app.state === 'STARTED') {
          try {
            const sessions = await this.emrBackend.listSessions(app.id);
            this.sessionsByApp.set(app.id, sessions);
            for (const session of sessions) {
              this.maybeRecordFailureFromSession(app.id, session);
            }
          } catch {
            this.sessionsByApp.set(app.id, []);
          }
        }
      }
      this.pruneSessionFailures();
    } catch (error) {
      this.loadError = formatAwsAuthError(error);
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

      return this.applications.map((app) => {
        const kind = kindForApplicationState(app.state);
        const running = kind === 'applicationRunning';
        const sessionCount = this.sessionsByApp.get(app.id)?.length ?? 0;
        const description =
          running
            ? `${app.state} · ${sessionCount} session(s)`
            : app.state;
        return new ApplicationsTreeItem(
          kind,
          { applicationId: app.id, applicationName: app.name, region: this.region },
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

    if (
      element.kind === 'applicationRunning' &&
      element.context.applicationId
    ) {
      const sessions = this.sessionsByApp.get(element.context.applicationId) ?? [];
      const items: ApplicationsTreeItem[] = sessions.map((session) => {
        const kind = kindForSessionState(session.state);
        const failure = this.sessionFailures.get(
          sessionFailureKey(element.context.applicationId!, session.id)
        );
        return new ApplicationsTreeItem(
          kind,
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
            tooltip: formatSessionTooltip(session, failure),
          }
        );
      });

      const appId = element.context.applicationId!;
      if (this.pendingSessionCreate.has(appId)) {
        const pendingName = this.pendingSessionCreate.get(appId);
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
      } else if (!this.emrBackend.isCreatingSession(appId)) {
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
  emrBackend: EmrSparkBackend
): ApplicationsTreeProvider {
  const provider = new ApplicationsTreeProvider(emrBackend);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(APPLICATIONS_VIEW_ID, provider)
  );

  void provider.loadApplications();

  return provider;
}
