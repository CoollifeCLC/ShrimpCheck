import * as vscode from 'vscode';
import { CHALLENGES, getChallengeById } from './catalog';
import { ACTIVE_SESSION_KEY, computeStats, loadAttempts, recordAttempt } from './history';
import { RunSummary, runChallengeTests } from './runner';
import { renderStars } from './scoring';
import { selectChallenge } from './selection';
import { ChallengeSession, SessionSnapshot } from './session';
import { readChallengeSettings } from './settings';
import { AssistanceKind, CATEGORY_LABELS, Challenge, DIFFICULTY_LABELS } from './types';
import {
  ChallengeResultView,
  ChallengeViewState,
  buildChallengeViewState,
  buildResultView,
  createNonce,
  renderChallengeHtml,
  renderStatsHtml
} from './view';

type WebviewMessage = { type: string; kind?: string };

/**
 * Owns the single active challenge session, its webview panel, and the
 * solution file. Scheduling stays in extension.ts next to the other timers.
 */
export class ChallengeController implements vscode.Disposable {
  private session: ChallengeSession | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private statsPanel: vscode.WebviewPanel | undefined;
  private revealed: Partial<Record<AssistanceKind, string>> = {};
  private lastRun: ChallengeViewState['lastRun'];
  private result: ChallengeResultView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onChange: () => void
  ) {
    this.restoreSession();
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  get activeChallenge(): Challenge | undefined {
    return this.session && !this.session.isFinished ? this.session.challenge : undefined;
  }

  hasActiveSession(): boolean {
    return this.activeChallenge !== undefined;
  }

  pickNext(): Challenge | undefined {
    const settings = readChallengeSettings(vscode.workspace.getConfiguration('shrimpCheck'));
    return selectChallenge(CHALLENGES, settings, loadAttempts(this.context.globalState));
  }

  solvedCount(): number {
    return loadAttempts(this.context.globalState).filter((attempt) => attempt.correct).length;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** Starts a fresh attempt. The challenge clock starts now. */
  async start(challenge: Challenge): Promise<void> {
    if (this.hasActiveSession()) {
      await this.abandon();
    }

    this.session = new ChallengeSession(challenge, Date.now());
    this.revealed = {};
    this.lastRun = undefined;
    this.result = undefined;
    await this.persistSession();

    await this.writeStarterCode(challenge);
    await this.openSolutionEditor();
    this.showPanel();
    this.onChange();
  }

  /** Re-opens the panel and editor for the active attempt. The clock never paused. */
  async resume(): Promise<void> {
    if (!this.session) return;
    await this.openSolutionEditor();
    this.showPanel();
  }

  /** Ends the active attempt without a solve. Recorded as abandoned, 0 stars. */
  async abandon(): Promise<void> {
    if (!this.session || this.session.isFinished) return;
    const attempt = this.session.abandon(Date.now());
    await recordAttempt(this.context.globalState, attempt);
    await this.clearSession();
    this.panel?.dispose();
    this.onChange();
  }

  showStats(): void {
    const stats = computeStats(loadAttempts(this.context.globalState));
    if (!this.statsPanel) {
      this.statsPanel = vscode.window.createWebviewPanel(
        'shrimpCheck.challengeStats',
        '🦐 Challenge Stats',
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        { enableScripts: false }
      );
      this.statsPanel.onDidDispose(() => (this.statsPanel = undefined), null, this.disposables);
    } else {
      this.statsPanel.reveal();
    }
    this.statsPanel.webview.html = renderStatsHtml(stats, {
      cspSource: this.statsPanel.webview.cspSource,
      nonce: createNonce()
    });
  }

  dispose(): void {
    this.panel?.dispose();
    this.statsPanel?.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }

  // ── Panel ───────────────────────────────────────────────────────────────

  private showPanel(): void {
    if (!this.session) return;

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'shrimpCheck.challenge',
        '🦐 Challenge',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
      );
      this.panel.onDidDispose(() => (this.panel = undefined), null, this.disposables);
      this.panel.webview.onDidReceiveMessage(
        (message: WebviewMessage) => this.handleMessage(message),
        null,
        this.disposables
      );
    } else {
      this.panel.reveal(undefined, true);
    }

    this.panel.title = `🦐 ${this.session.challenge.title}`;
    this.panel.webview.html = renderChallengeHtml(this.viewState(), {
      cspSource: this.panel.webview.cspSource,
      nonce: createNonce()
    });
  }

  private viewState(): ChallengeViewState {
    const session = this.session as ChallengeSession;
    const settings = readChallengeSettings(vscode.workspace.getConfiguration('shrimpCheck'));
    return buildChallengeViewState(
      session.challenge,
      session.startedAt,
      settings.thresholds,
      this.revealed,
      this.lastRun,
      this.result
    );
  }

  private postState(): void {
    if (!this.panel || !this.session) return;
    void this.panel.webview.postMessage({ type: 'state', state: this.viewState() });
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'assist':
          await this.useAssistance(message.kind);
          break;
        case 'run':
          await this.runTests(false);
          break;
        case 'submit':
          await this.runTests(true);
          break;
        case 'openEditor':
          await this.openSolutionEditor();
          break;
        case 'resetCode':
          await this.resetCode();
          break;
        case 'skip':
          await this.confirmSkip();
          break;
        case 'newChallenge':
          await vscode.commands.executeCommand('shrimpCheck.startChallenge');
          break;
        case 'stats':
          this.showStats();
          break;
        case 'close':
          this.panel?.dispose();
          break;
      }
    } catch (error) {
      void this.panel?.webview.postMessage({ type: 'idle' });
      vscode.window.showErrorMessage(`🦐 Challenge Mode hit a snag: ${String(error)}`);
    }
  }

  private async useAssistance(kind: string | undefined): Promise<void> {
    if (!this.session || this.session.isFinished) return;
    if (kind !== 'pattern' && kind !== 'hint' && kind !== 'approach') return;
    this.revealed[kind] = this.session.useAssistance(kind);
    await this.persistSession();
    this.postState();
  }

  private async runTests(isSubmit: boolean): Promise<void> {
    if (!this.session || this.session.isFinished) return;
    const challenge = this.session.challenge;
    const source = await this.readSolution();
    const summary: RunSummary = await runChallengeTests(challenge, source, { includeHidden: isSubmit });
    this.lastRun = { kind: isSubmit ? 'submit' : 'run', summary };

    if (isSubmit) {
      const settings = readChallengeSettings(vscode.workspace.getConfiguration('shrimpCheck'));
      const outcome = this.session.submit(summary, Date.now(), settings.thresholds);

      if (outcome.attempt) {
        await recordAttempt(this.context.globalState, outcome.attempt);
        await this.clearSession();
        this.result = buildResultView(
          challenge,
          outcome.score.stars,
          outcome.elapsedMs,
          outcome.attempt.assistance,
          outcome.attempt.submissions,
          outcome.score.rawTimingStars,
          outcome.score.cap
        );
        this.onChange();
        vscode.window.setStatusBarMessage(
          `🦐 ${challenge.title} solved ${renderStars(outcome.score.stars)}`,
          8000
        );
      } else {
        await this.persistSession();
      }
    }

    this.postState();
  }

  private async confirmSkip(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      'Skip this challenge? It will be logged as an unsolved attempt.',
      'Skip',
      'Keep going'
    );
    if (choice === 'Skip') await this.abandon();
  }

  // ── Solution file ───────────────────────────────────────────────────────

  private solutionUri(challenge: Challenge): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'challenges', `${challenge.id}.js`);
  }

  private async writeStarterCode(challenge: Challenge): Promise<void> {
    const uri = this.solutionUri(challenge);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.context.globalStorageUri, 'challenges'));

    const header =
      `// 🦐 Shrimp Check challenge: ${challenge.title}\n` +
      `// ${DIFFICULTY_LABELS[challenge.difficulty]} · ${CATEGORY_LABELS[challenge.category]}\n` +
      `// Write your solution below, then use Run Tests / Submit in the challenge panel.\n` +
      `// No need to save — the panel reads what is in the editor.\n\n`;
    const content = header + challenge.starterCode;

    const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
    if (open) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(0, 0, open.lineCount, 0), content);
      await vscode.workspace.applyEdit(edit);
      await open.save();
    } else {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    }
  }

  private async resetCode(): Promise<void> {
    if (!this.session) return;
    const choice = await vscode.window.showWarningMessage(
      'Replace your solution with the starter code?',
      'Reset',
      'Cancel'
    );
    if (choice !== 'Reset') return;
    await this.writeStarterCode(this.session.challenge);
    await this.openSolutionEditor();
  }

  private async openSolutionEditor(): Promise<void> {
    if (!this.session) return;
    const document = await vscode.workspace.openTextDocument(this.solutionUri(this.session.challenge));
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
      preserveFocus: false
    });
  }

  private async readSolution(): Promise<string> {
    const uri = this.solutionUri((this.session as ChallengeSession).challenge);
    const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
    if (open) return open.getText();
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  }

  // ── Persistence of the in-flight attempt ────────────────────────────────

  private async persistSession(): Promise<void> {
    if (!this.session) return;
    await this.context.globalState.update(ACTIVE_SESSION_KEY, this.session.snapshot());
  }

  private async clearSession(): Promise<void> {
    await this.context.globalState.update(ACTIVE_SESSION_KEY, undefined);
  }

  private restoreSession(): void {
    const snapshot = this.context.globalState.get<SessionSnapshot | undefined>(ACTIVE_SESSION_KEY, undefined);
    if (!snapshot || typeof snapshot.challengeId !== 'string') return;
    const challenge = getChallengeById(snapshot.challengeId);
    if (!challenge) return;
    this.session = new ChallengeSession(challenge, snapshot.startedAt, snapshot);
    for (const kind of this.session.assistance) {
      this.revealed[kind] = this.session.useAssistance(kind);
    }
  }
}
