import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem;
let warningTimeout: NodeJS.Timeout | undefined;
let dangerTimeout: NodeJS.Timeout | undefined;

let isEnabled = true;

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'shrimpCheck.resetPosture';
  context.subscriptions.push(statusBarItem);

  const resetCommand = vscode.commands.registerCommand('shrimpCheck.resetPosture', async () => {
    if (!isEnabled) {
      return;
    }

    vscode.window.showInformationMessage('🫡 Posture reset. You are human again.');
    startCycle();
  });

  const snoozeCommand = vscode.commands.registerCommand('shrimpCheck.snooze', async () => {
    if (!isEnabled) {
      return;
    }

    clearTimers();
    setStatus('😌 Snoozed', 'Shrimp Check snoozed for 10 minutes.');
    vscode.window.showInformationMessage('😌 Shrimp Check snoozed for 10 minutes.');

    dangerTimeout = setTimeout(() => {
      startCycle();
    }, 10 * 60 * 1000);
  });

  const toggleCommand = vscode.commands.registerCommand('shrimpCheck.toggle', async () => {
    const config = vscode.workspace.getConfiguration('shrimpCheck');
    const current = config.get<boolean>('enabled', true);
    await config.update('enabled', !current, vscode.ConfigurationTarget.Global);
  });

  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('shrimpCheck')) {
      refreshFromConfig();
    }
  });

  context.subscriptions.push(resetCommand, snoozeCommand, toggleCommand, configListener);

  refreshFromConfig();
}

function refreshFromConfig(): void {
  const config = vscode.workspace.getConfiguration('shrimpCheck');
  isEnabled = config.get<boolean>('enabled', true);

  clearTimers();

  if (!isEnabled) {
    setStatus('🚫 Shrimp Off', 'Shrimp Check is disabled.');
    statusBarItem.show();
    return;
  }

  statusBarItem.show();
  startCycle();
}

function startCycle(): void {
  clearTimers();

  const config = vscode.workspace.getConfiguration('shrimpCheck');
  const minMinutes = config.get<number>('minMinutes', 30);
  const maxMinutes = config.get<number>('maxMinutes', 45);
  const warningFraction = config.get<number>('warningFraction', 0.66);
  const showPopup = config.get<boolean>('showPopup', true);

  const safeMin = Math.max(1, minMinutes);
  const safeMax = Math.max(safeMin, maxMinutes);

  const totalMs = randomBetween(safeMin * 60_000, safeMax * 60_000);
  const warningMs = Math.floor(totalMs * warningFraction);

  setStatus('🙂 Posture OK', 'Shrimp Check is watching your spine. Click to reset.');

  warningTimeout = setTimeout(() => {
    setStatus('🟡 Shrimp forming...', 'Warning: spinal shrimp activity increasing.');
  }, warningMs);

  dangerTimeout = setTimeout(async () => {
    setStatus('🦐 Un-shrimp', 'Critical posture event detected. Click to reset.');

    if (showPopup) {
      const selection = await vscode.window.showWarningMessage(
        '🦐 Posture Check! Un-shrimp yourself.',
        'Reset',
        'Snooze 10 min'
      );

      if (selection === 'Reset') {
        startCycle();
      } else if (selection === 'Snooze 10 min') {
        await vscode.commands.executeCommand('shrimpCheck.snooze');
      }
    }
  }, totalMs);
}

function setStatus(text: string, tooltip: string): void {
  statusBarItem.text = text;
  statusBarItem.tooltip = tooltip;
}

function clearTimers(): void {
  if (warningTimeout) {
    clearTimeout(warningTimeout);
    warningTimeout = undefined;
  }

  if (dangerTimeout) {
    clearTimeout(dangerTimeout);
    dangerTimeout = undefined;
  }
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function deactivate(): void {
  clearTimers();
}