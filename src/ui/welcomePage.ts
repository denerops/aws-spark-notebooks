import * as vscode from 'vscode';
import { renderWelcomePageHtml } from './welcomeContent';

const WELCOME_PANEL_TYPE = 'emrServerlessWelcome';
const WELCOME_SHOWN_KEY = 'emrServerless.welcomeShown';

type WelcomeMessage = { type: 'runCommand'; command: string };

export class WelcomePagePanel {
  private static current: WelcomePagePanel | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri
  ) {
    panel.webview.html = renderWelcomePageHtml(panel.webview, extensionUri);

    panel.webview.onDidReceiveMessage((message: WelcomeMessage) => {
      if (message.type === 'runCommand' && message.command) {
        void vscode.commands.executeCommand(message.command);
      }
    });

    panel.onDidDispose(() => {
      WelcomePagePanel.current = undefined;
    });
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.One);
  }

  static show(context: vscode.ExtensionContext, options?: { reveal?: boolean }): void {
    if (WelcomePagePanel.current) {
      if (options?.reveal !== false) {
        WelcomePagePanel.current.reveal();
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      WELCOME_PANEL_TYPE,
      'EMR Serverless PySpark — Help',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      }
    );

    WelcomePagePanel.current = new WelcomePagePanel(panel, context.extensionUri);
  }
}

export function registerWelcomePage(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.openWelcome', () => {
      WelcomePagePanel.show(context);
    })
  );
}

export async function showWelcomeOnFirstInstall(context: vscode.ExtensionContext): Promise<void> {
  const alreadyShown = context.globalState.get<boolean>(WELCOME_SHOWN_KEY, false);
  if (alreadyShown) {
    return;
  }

  await context.globalState.update(WELCOME_SHOWN_KEY, true);
  WelcomePagePanel.show(context);
}
