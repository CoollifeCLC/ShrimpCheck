import * as vscode from 'vscode';

type ShrimpState = 'ok' | 'warning' | 'cooked';

let statusBarItem: vscode.StatusBarItem;

let warningTimeout: ReturnType<typeof setTimeout> | undefined;
let cookedTimeout: ReturnType<typeof setTimeout> | undefined;
let hydrationTimeout: ReturnType<typeof setTimeout> | undefined;

let isEnabled = true;
let currentState: ShrimpState = 'ok';
let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'shrimpCheck.resetPosture';
  context.subscriptions.push(statusBarItem);

  const resetCommand = vscode.commands.registerCommand('shrimpCheck.resetPosture', async () => {
    if (!isEnabled) {
      return;
    }

    if (currentState === 'warning') {
      await incrementStreak();
      vscode.window.showInformationMessage(`🫡 Posture corrected. Streak: ${getStreak()}`);
    } else if (currentState === 'cooked') {
      vscode.window.showInformationMessage('🍤 Recovery started. Start a new streak.');
    } else {
      vscode.window.showInformationMessage('🙂 Timer reset. No shrimp detected yet.');
    }

    startCycle();
  });

  const snoozeCommand = vscode.commands.registerCommand('shrimpCheck.snooze', async () => {
    if (!isEnabled) {
      return;
    }

    clearPostureTimers();
    setStatus(
      '😌 Snoozed',
      `Current streak: ${getStreak()}. Shrimp Check snoozed for 5 minutes.`,
      undefined
    );

    const selection = await vscode.window.showInformationMessage(
      '😌 Shrimp Check snoozed for 5 minutes.',
      'I’m up 😅'
    );

    if (selection === 'I’m up 😅') {
      if (currentState === 'warning') {
        await incrementStreak();
      }
      startCycle();
      return;
    }

    cookedTimeout = setTimeout(() => {
      startCycle();
    }, 5 * 60 * 1000);
  });

  const toggleCommand = vscode.commands.registerCommand('shrimpCheck.toggle', async () => {
    const config = vscode.workspace.getConfiguration('shrimpCheck');
    const current = config.get<boolean>('enabled', true);
    await config.update('enabled', !current, vscode.ConfigurationTarget.Global);
  });

  const hydrationMenuCommand = vscode.commands.registerCommand('shrimpCheck.hydrationMenu', async () => {
    await showHydrationMenu();
  });

  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('shrimpCheck')) {
      refreshFromConfig();
    }
  });

  context.subscriptions.push(
    resetCommand,
    snoozeCommand,
    toggleCommand,
    hydrationMenuCommand,
    configListener
  );

  refreshFromConfig();
}

function refreshFromConfig(): void {
  const config = vscode.workspace.getConfiguration('shrimpCheck');
  isEnabled = config.get<boolean>('enabled', true);

  clearAllTimers();

  if (!isEnabled) {
    currentState = 'ok';
    setStatus('🚫 Shrimp Off', 'Shrimp Check is disabled.', undefined);
    statusBarItem.show();
    return;
  }

  statusBarItem.show();
  startCycle();
  startHydrationCycle();
}

function startCycle(): void {
  clearPostureTimers();
  currentState = 'ok';

  const config = vscode.workspace.getConfiguration('shrimpCheck');
  const minMinutes = config.get<number>('minMinutes', 30);
  const maxMinutes = config.get<number>('maxMinutes', 45);
  const warningFraction = config.get<number>('warningFraction', 0.66);
  const showPopup = config.get<boolean>('showPopup', true);
  const cookedDelayMinutes = config.get<number>('cookedDelayMinutes', 10);

  const safeMin = Math.max(1, minMinutes);
  const safeMax = Math.max(safeMin, maxMinutes);
  const safeCookedDelay = Math.max(1, cookedDelayMinutes);

  const totalMs = randomBetween(safeMin * 60_000, safeMax * 60_000);
  const warningMs = Math.floor(totalMs * warningFraction);
  const cookedMs = safeCookedDelay * 60_000;

  setStatus(
    '🙂 Posture OK',
    `Current streak: ${getStreak()}. Shrimp Check is watching your spine. Click to reset.`,
    undefined
  );

  warningTimeout = setTimeout(async () => {
    currentState = 'warning';

    setStatus(
      '🟡 Shrimp forming...',
      `Current streak: ${getStreak()}. You’re about to get cooked. Fix your posture.`,
      new vscode.ThemeColor('statusBarItem.warningBackground')
    );

    if (showPopup) {
      const selection = await vscode.window.showWarningMessage(
        '🟡 Shrimp forming... you’re about to get cooked. Check your posture.',
        'I’m up 😅',
        'Give me 5 min'
      );

      if (selection === 'I’m up 😅') {
        await incrementStreak();
        vscode.window.showInformationMessage(`🔥 Spine strong. Streak: ${getStreak()}`);
        startCycle();
        return;
      }

      if (selection === 'Give me 5 min') {
        await vscode.commands.executeCommand('shrimpCheck.snooze');
      }
    }
  }, warningMs);

  cookedTimeout = setTimeout(async () => {
    await handleCookedState(showPopup);
  }, totalMs + cookedMs);
}

async function handleCookedState(showPopup: boolean): Promise<void> {
  currentState = 'cooked';
  await resetStreak();

  setStatus(
    '🍤 Cooked - Un-Shrimp',
    'You ignored the shrimp… now you’re cooked! Stand up and stretch, your back will thank you.',
    new vscode.ThemeColor('statusBarItem.errorBackground')
  );

  if (!showPopup) {
    return;
  }

  const selection = await vscode.window.showErrorMessage(
    '🍤 You ignored the shrimp… now you’re cooked! Stand up and stretch, your back will thank you.',
    'I’m up 😅',
    'Give me 5 min'
  );

  if (selection === 'I’m up 😅') {
    vscode.window.showInformationMessage('🫡 Recovery complete. Start a new streak.');
    startCycle();
    return;
  }

  if (selection === 'Give me 5 min') {
    await vscode.commands.executeCommand('shrimpCheck.snooze');
  }
}

function startHydrationCycle(): void {
  if (hydrationTimeout) {
    clearTimeout(hydrationTimeout);
    hydrationTimeout = undefined;
  }

  const config = vscode.workspace.getConfiguration('shrimpCheck');
  const hydrationEnabled = config.get<boolean>('hydrationEnabled', false);
  const hydrationMinutes = config.get<number>('hydrationMinutes', 45);

  if (!hydrationEnabled) {
    return;
  }

  const safeHydrationMinutes = Math.max(1, hydrationMinutes);

  hydrationTimeout = setTimeout(async () => {
    const selection = await vscode.window.showInformationMessage(
      '💧 Hydration check! Drink some water before you become 70% coffee.',
      'Hydrated ✅',
      'Later',
      'Hydration Settings'
    );

    if (selection === 'Hydrated ✅') {
      vscode.window.showInformationMessage('💧 Nice. The shrimp remains hydrated.');
    } else if (selection === 'Hydration Settings') {
      await vscode.commands.executeCommand('shrimpCheck.hydrationMenu');
    }

    startHydrationCycle();
  }, safeHydrationMinutes * 60_000);
}

async function showHydrationMenu(): Promise<void> {
  const config = vscode.workspace.getConfiguration('shrimpCheck');
  const hydrationEnabled = config.get<boolean>('hydrationEnabled', false);
  const hydrationMinutes = config.get<number>('hydrationMinutes', 45);

  const selection = await vscode.window.showQuickPick(
    [
      {
        label: hydrationEnabled ? 'Disable Hydration Checks' : 'Enable Hydration Checks',
        description: `Currently ${hydrationEnabled ? 'On' : 'Off'}`
      },
      {
        label: 'Set hydration to 15 minutes',
        description: hydrationMinutes === 15 ? 'Current' : undefined
      },
      {
        label: 'Set hydration to 30 minutes',
        description: hydrationMinutes === 30 ? 'Current' : undefined
      },
      {
        label: 'Set hydration to 45 minutes',
        description: hydrationMinutes === 45 ? 'Current' : undefined
      },
      {
        label: 'Set hydration to 60 minutes',
        description: hydrationMinutes === 60 ? 'Current' : undefined
      },
      {
        label: 'Test hydration notification now',
        description: 'Fire a hydration check immediately'
      }
    ],
    {
      placeHolder: 'Manage hydration reminders'
    }
  );

  if (!selection) {
    return;
  }

  switch (selection.label) {
    case 'Enable Hydration Checks':
      await config.update('hydrationEnabled', true, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('💧 Hydration checks enabled.');
      break;

    case 'Disable Hydration Checks':
      await config.update('hydrationEnabled', false, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('💧 Hydration checks disabled.');
      break;

    case 'Set hydration to 15 minutes':
      await config.update('hydrationMinutes', 15, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('💧 Hydration timer set to 15 minutes.');
      break;

    case 'Set hydration to 30 minutes':
      await config.update('hydrationMinutes', 30, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('💧 Hydration timer set to 30 minutes.');
      break;

    case 'Set hydration to 45 minutes':
      await config.update('hydrationMinutes', 45, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('💧 Hydration timer set to 45 minutes.');
      break;

    case 'Set hydration to 60 minutes':
      await config.update('hydrationMinutes', 60, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('💧 Hydration timer set to 60 minutes.');
      break;

    case 'Test hydration notification now':
      await vscode.window.showInformationMessage(
        '💧 Hydration check! Drink some water before you become 70% coffee.'
      );
      break;
  }

  refreshFromConfig();
}

function setStatus(
  text: string,
  tooltip: string,
  backgroundColor?: vscode.ThemeColor
): void {
  statusBarItem.text = text;
  statusBarItem.tooltip = tooltip;
  statusBarItem.backgroundColor = backgroundColor;
  statusBarItem.color = undefined;
}

function clearPostureTimers(): void {
  if (warningTimeout) {
    clearTimeout(warningTimeout);
    warningTimeout = undefined;
  }

  if (cookedTimeout) {
    clearTimeout(cookedTimeout);
    cookedTimeout = undefined;
  }
}

function clearAllTimers(): void {
  clearPostureTimers();

  if (hydrationTimeout) {
    clearTimeout(hydrationTimeout);
    hydrationTimeout = undefined;
  }
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getStreak(): number {
  return extensionContext.globalState.get<number>('shrimpCheck.streak', 0);
}

async function incrementStreak(): Promise<void> {
  const streak = getStreak() + 1;
  await extensionContext.globalState.update('shrimpCheck.streak', streak);
}

async function resetStreak(): Promise<void> {
  await extensionContext.globalState.update('shrimpCheck.streak', 0);
}

export function deactivate(): void {
  clearAllTimers();
}