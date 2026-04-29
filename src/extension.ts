import * as vscode from 'vscode';

type ShrimpState = 'ok' | 'warning' | 'recovery' | 'cooked';

let statusBarItem: vscode.StatusBarItem;

let warningTimeout: ReturnType<typeof setTimeout> | undefined;
let cookedTimeout: ReturnType<typeof setTimeout> | undefined;
let recoveryTimeout: ReturnType<typeof setTimeout> | undefined;
let hydrationTimeout: ReturnType<typeof setTimeout> | undefined;

let isEnabled = true;
let currentState: ShrimpState = 'ok';
let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'shrimpCheck.openQuickMenu';
  context.subscriptions.push(statusBarItem);

  const quickMenuCommand = vscode.commands.registerCommand('shrimpCheck.openQuickMenu', async () => {
    await showQuickMenu();
  });

  const resetCommand = vscode.commands.registerCommand('shrimpCheck.resetPosture', async () => {
    if (!isEnabled) return;

    if (currentState === 'warning') {
      await handleRecovery();
      return;
    }

    if (currentState === 'cooked') {
      vscode.window.showInformationMessage('🫡 Recovery started. New streak begins now.');
      startCycle();
      return;
    }

    if (currentState === 'recovery') return;

    vscode.window.showInformationMessage('🙂 Timer reset. No shrimp detected yet.');
    startCycle();
  });

  const snoozeCommand = vscode.commands.registerCommand('shrimpCheck.snooze', async () => {
    if (!isEnabled) return;

    clearPostureTimers();

    setStatus('😌 Snoozed', 'Shrimp Check snoozed for 5 minutes.');

    const selection = await vscode.window.showInformationMessage(
      '😌 Shrimp Check snoozed for 5 minutes.',
      'I’m up 😅'
    );

    if (selection === 'I’m up 😅') {
      if (currentState === 'warning') {
        await handleRecovery();
        return;
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

  const timerMenuCommand = vscode.commands.registerCommand('shrimpCheck.timerMenu', async () => {
    await showTimerMenu();
  });

  const openSettingsCommand = vscode.commands.registerCommand('shrimpCheck.openSettings', async () => {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'shrimpCheck');
  });

  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('shrimpCheck')) {
      refreshFromConfig();
    }
  });

  context.subscriptions.push(
    quickMenuCommand,
    resetCommand,
    snoozeCommand,
    toggleCommand,
    hydrationMenuCommand,
    timerMenuCommand,
    openSettingsCommand,
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
    setStatus('🚫 Shrimp Off', 'Shrimp Check is disabled.');
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
    `Current streak: ${getStreak()}. Monitoring posture… stay sharp 🦐 Click for quick settings.`
  );

  warningTimeout = setTimeout(async () => {
    currentState = 'warning';

    setStatus(
      '🟡 Shrimp forming...',
      `Current streak: ${getStreak()}. You may or may not be a shrimp right now 🦐…`,
      undefined,
      new vscode.ThemeColor('statusBarItem.warningForeground')
    );

    if (showPopup) {
      const selection = await vscode.window.showWarningMessage(
        '🟡 You may or may not be a shrimp right now 🦐… Check your posture.',
        'I’m up 😅',
        'Give me 5 min'
      );

      if (selection === 'I’m up 😅') {
        await handleRecovery();
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

async function handleRecovery(): Promise<void> {
  clearPostureTimers();
  currentState = 'recovery';
  await incrementStreak();

  setStatus(
    '🦐 Un-Shrimp',
    `Streak: ${getStreak()}. You corrected in time.`,
    undefined,
    new vscode.ThemeColor('statusBarItem.prominentForeground')
  );

  vscode.window.showInformationMessage(`🦐 Un-shrimped. Streak: ${getStreak()}`);

  recoveryTimeout = setTimeout(() => {
    startCycle();
  }, 2000);
}

async function handleCookedState(showPopup: boolean): Promise<void> {
  clearPostureTimers();
  currentState = 'cooked';
  await resetStreak();

  const cookedMessage =
    '🍤 The shrimp may have gotten the best of you this time… Streak reset. Let’s stand up and recover.';

  setStatus(
    '🍤 Cooked',
    cookedMessage,
    new vscode.ThemeColor('statusBarItem.errorBackground'),
    new vscode.ThemeColor('statusBarItem.errorForeground')
  );

  if (!showPopup) return;

  const selection = await vscode.window.showErrorMessage(
    cookedMessage,
    'I’m up 😅',
    'Give me 5 min'
  );

  if (selection === 'I’m up 😅') {
    vscode.window.showInformationMessage('🫡 Back on your feet. New cycle started.');
    startCycle();
    return;
  }

  if (selection === 'Give me 5 min') {
    await vscode.commands.executeCommand('shrimpCheck.snooze');
  }
}

async function showQuickMenu(): Promise<void> {
  const config = vscode.workspace.getConfiguration('shrimpCheck');
  const enabled = config.get<boolean>('enabled', true);
  const minMinutes = config.get<number>('minMinutes', 30);
  const maxMinutes = config.get<number>('maxMinutes', 45);
  const cookedDelayMinutes = config.get<number>('cookedDelayMinutes', 10);
  const hydrationEnabled = config.get<boolean>('hydrationEnabled', false);

  const selection = await vscode.window.showQuickPick(
    [
      {
        label: 'Reset posture timer',
        description: 'Start a fresh Shrimp Check cycle'
      },
      {
        label: 'Snooze for 5 minutes',
        description: 'Pause posture reminders briefly'
      },
      {
        label: 'Adjust posture timer',
        description: `Current: ${minMinutes}-${maxMinutes} minutes`
      },
      {
        label: 'Adjust cooked delay',
        description: `Current: ${cookedDelayMinutes} minutes after warning`
      },
      {
        label: 'Hydration settings',
        description: `Currently ${hydrationEnabled ? 'On' : 'Off'}`
      },
      {
        label: enabled ? 'Disable Shrimp Check' : 'Enable Shrimp Check',
        description: `Currently ${enabled ? 'On' : 'Off'}`
      },
      {
        label: 'Open full settings',
        description: 'Open VS Code settings for Shrimp Check'
      }
    ],
    {
      placeHolder: 'Shrimp Check quick settings 🦐'
    }
  );

  if (!selection) return;

  switch (selection.label) {
    case 'Reset posture timer':
      await vscode.commands.executeCommand('shrimpCheck.resetPosture');
      break;

    case 'Snooze for 5 minutes':
      await vscode.commands.executeCommand('shrimpCheck.snooze');
      break;

    case 'Adjust posture timer':
      await showTimerMenu();
      break;

    case 'Adjust cooked delay':
      await showCookedDelayMenu();
      break;

    case 'Hydration settings':
      await showHydrationMenu();
      break;

    case 'Disable Shrimp Check':
    case 'Enable Shrimp Check':
      await vscode.commands.executeCommand('shrimpCheck.toggle');
      break;

    case 'Open full settings':
      await vscode.commands.executeCommand('shrimpCheck.openSettings');
      break;
  }
}

async function showTimerMenu(): Promise<void> {
  const config = vscode.workspace.getConfiguration('shrimpCheck');
  const configTarget = vscode.ConfigurationTarget.Global;

  const selection = await vscode.window.showQuickPick(
    [
      {
        label: 'Quick check: 15-25 minutes',
        min: 15,
        max: 25
      },
      {
        label: 'Balanced: 30-45 minutes',
        min: 30,
        max: 45
      },
      {
        label: 'Deep work: 45-60 minutes',
        min: 45,
        max: 60
      },
      {
        label: 'Custom timer range',
        min: undefined,
        max: undefined
      }
    ],
    {
      placeHolder: 'Choose Shrimp Check timer duration'
    }
  );

  if (!selection) return;

  if (selection.label === 'Custom timer range') {
    const input = await vscode.window.showInputBox({
      prompt: 'Enter min and max minutes separated by a dash',
      placeHolder: 'Example: 25-40'
    });

    if (!input) return;

    const [rawMin, rawMax] = input.split('-').map((value) => Number(value.trim()));
    const safeMin = Number.isFinite(rawMin) ? Math.max(1, rawMin) : 30;
    const safeMax = Number.isFinite(rawMax) ? Math.max(safeMin, rawMax) : safeMin;

    await config.update('minMinutes', safeMin, configTarget);
    await config.update('maxMinutes', safeMax, configTarget);

    vscode.window.showInformationMessage(`🦐 Posture timer set to ${safeMin}-${safeMax} minutes.`);
    refreshFromConfig();
    return;
  }

  await config.update('minMinutes', selection.min, configTarget);
  await config.update('maxMinutes', selection.max, configTarget);

  vscode.window.showInformationMessage(
    `🦐 Posture timer set to ${selection.min}-${selection.max} minutes.`
  );

  refreshFromConfig();
}

async function showCookedDelayMenu(): Promise<void> {
  const config = vscode.workspace.getConfiguration('shrimpCheck');
  const configTarget = vscode.ConfigurationTarget.Global;

  const selection = await vscode.window.showQuickPick(
    [
      {
        label: '5 minutes',
        value: 5
      },
      {
        label: '10 minutes',
        value: 10
      },
      {
        label: '15 minutes',
        value: 15
      },
      {
        label: 'Custom delay',
        value: undefined
      }
    ],
    {
      placeHolder: 'How long after warning before cooked mode?'
    }
  );

  if (!selection) return;

  if (selection.label === 'Custom delay') {
    const input = await vscode.window.showInputBox({
      prompt: 'Enter cooked delay in minutes',
      placeHolder: 'Example: 10'
    });

    if (!input) return;

    const parsed = Number(input.trim());
    const safeDelay = Number.isFinite(parsed) ? Math.max(1, parsed) : 10;

    await config.update('cookedDelayMinutes', safeDelay, configTarget);
    vscode.window.showInformationMessage(`🍤 Cooked delay set to ${safeDelay} minutes.`);
    refreshFromConfig();
    return;
  }

  await config.update('cookedDelayMinutes', selection.value, configTarget);
  vscode.window.showInformationMessage(`🍤 Cooked delay set to ${selection.value} minutes.`);
  refreshFromConfig();
}

function startHydrationCycle(): void {
  if (hydrationTimeout) {
    clearTimeout(hydrationTimeout);
    hydrationTimeout = undefined;
  }

  const config = vscode.workspace.getConfiguration('shrimpCheck');
  const hydrationEnabled = config.get<boolean>('hydrationEnabled', false);
  const hydrationMinutes = config.get<number>('hydrationMinutes', 45);

  if (!hydrationEnabled) return;

  const safeHydrationMinutes = Math.max(1, hydrationMinutes);

  hydrationTimeout = setTimeout(async () => {
    const selection = await vscode.window.showInformationMessage(
      `💧 Hydration check! Drink some water before you become 70% ${getPreferredDrink()}.`,
      'Hydrated ✅',
      'Later',
      'Hydration Settings'
    );

    if (selection === 'Hydrated ✅') {
      vscode.window.showInformationMessage('💧 Nice. Stay hydrated.');
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
        label: 'Set custom drink',
        description: `Current: ${getPreferredDrink()}`
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

  if (!selection) return;

  const configTarget = vscode.ConfigurationTarget.Global;

  switch (selection.label) {
    case 'Enable Hydration Checks':
      await config.update('hydrationEnabled', true, configTarget);
      vscode.window.showInformationMessage('💧 Hydration checks enabled.');
      break;

    case 'Disable Hydration Checks':
      await config.update('hydrationEnabled', false, configTarget);
      vscode.window.showInformationMessage('💧 Hydration checks disabled.');
      break;

    case 'Set hydration to 15 minutes':
      await config.update('hydrationMinutes', 15, configTarget);
      vscode.window.showInformationMessage('💧 Hydration timer set to 15 minutes.');
      break;

    case 'Set hydration to 30 minutes':
      await config.update('hydrationMinutes', 30, configTarget);
      vscode.window.showInformationMessage('💧 Hydration timer set to 30 minutes.');
      break;

    case 'Set hydration to 45 minutes':
      await config.update('hydrationMinutes', 45, configTarget);
      vscode.window.showInformationMessage('💧 Hydration timer set to 45 minutes.');
      break;

    case 'Set hydration to 60 minutes':
      await config.update('hydrationMinutes', 60, configTarget);
      vscode.window.showInformationMessage('💧 Hydration timer set to 60 minutes.');
      break;

    case 'Set custom drink': {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter your preferred coding beverage',
        placeHolder: 'coffee, tea, matcha, energy drink...'
      });

      if (input !== undefined) {
        const trimmed = input.trim();
        await config.update('drink', trimmed, configTarget);
        vscode.window.showInformationMessage(
          `💧 Drink preference set to ${trimmed || 'caffeine'}.`
        );
      }
      break;
    }

    case 'Test hydration notification now':
      await vscode.window.showInformationMessage(
        `💧 Hydration check! Drink some water before you become 70% ${getPreferredDrink()}.`
      );
      break;
  }

  refreshFromConfig();
}

function setStatus(
  text: string,
  tooltipText: string,
  backgroundColor?: vscode.ThemeColor,
  foregroundColor?: vscode.ThemeColor
): void {
  statusBarItem.text = text;
  statusBarItem.tooltip = createShrimpTooltip(tooltipText);
  statusBarItem.backgroundColor = backgroundColor;
  statusBarItem.color = foregroundColor;
}

function createShrimpTooltip(message: string): vscode.MarkdownString {
  const config = vscode.workspace.getConfiguration('shrimpCheck');
  const minMinutes = config.get<number>('minMinutes', 30);
  const maxMinutes = config.get<number>('maxMinutes', 45);
  const cookedDelayMinutes = config.get<number>('cookedDelayMinutes', 10);
  const hydrationEnabled = config.get<boolean>('hydrationEnabled', false);
  const hydrationMinutes = config.get<number>('hydrationMinutes', 45);
  const showPopup = config.get<boolean>('showPopup', true);
  const enabled = config.get<boolean>('enabled', true);

  const streak = getStreak();

  const stateLabel =
    currentState === 'ok'
      ? 'Posture OK'
      : currentState === 'warning'
        ? 'Shrimp forming'
        : currentState === 'recovery'
          ? 'Recovering'
          : 'Cooked';

  const stateIcon =
    currentState === 'ok'
      ? '🙂'
      : currentState === 'warning'
        ? '🟡'
        : currentState === 'recovery'
          ? '🦐'
          : '🍤';

  const tooltip = new vscode.MarkdownString();
  tooltip.isTrusted = true;
  tooltip.supportHtml = true;

  tooltip.appendMarkdown(`### 🦐 Shrimp Check\n\n`);
  tooltip.appendMarkdown(`_Tiny posture guard for developers._\n\n`);
  tooltip.appendMarkdown(`${message}\n\n`);

  tooltip.appendMarkdown(`---\n\n`);

  tooltip.appendMarkdown(`**📊 Status**\n\n`);
  tooltip.appendMarkdown(`- ${enabled ? '☑' : '☐'} **Enabled:** ${enabled ? 'On' : 'Off'}\n`);
  tooltip.appendMarkdown(`- ${stateIcon} **State:** ${stateLabel}\n`);
  tooltip.appendMarkdown(`- 🔥 **Streak:** ${streak}\n\n`);

  tooltip.appendMarkdown(`**⏱ Timers**\n\n`);
  tooltip.appendMarkdown(`- ☑ **Posture Timer:** ${minMinutes}-${maxMinutes} min\n`);
  tooltip.appendMarkdown(`- ☑ **Cooked Delay:** ${cookedDelayMinutes} min\n`);
  tooltip.appendMarkdown(`- ${showPopup ? '☑' : '☐'} **Popups:** ${showPopup ? 'On' : 'Off'}\n`);
  tooltip.appendMarkdown(
    `- ${hydrationEnabled ? '☑' : '☐'} **Hydration:** ${
      hydrationEnabled ? `Every ${hydrationMinutes} min` : 'Off'
    }\n\n`
  );

  tooltip.appendMarkdown(`---\n\n`);

  tooltip.appendMarkdown(`**⚡ Quick Actions**\n\n`);
  tooltip.appendMarkdown(`[Open Quick Menu](command:shrimpCheck.openQuickMenu)  \n`);
  tooltip.appendMarkdown(`[Reset Timer](command:shrimpCheck.resetPosture)  \n`);
  tooltip.appendMarkdown(`[Snooze 5 Min](command:shrimpCheck.snooze)\n\n`);

  tooltip.appendMarkdown(`**🛠 Settings**\n\n`);
  tooltip.appendMarkdown(`[Adjust Timers](command:shrimpCheck.timerMenu)  \n`);
  tooltip.appendMarkdown(`[Hydration Settings](command:shrimpCheck.hydrationMenu)  \n`);
  tooltip.appendMarkdown(`[Open Full Settings](command:shrimpCheck.openSettings)\n`);

  tooltip.appendMarkdown(`\n---\n`);
  tooltip.appendMarkdown(`_Stay productive. Stay hydrated. Don’t become the shrimp._`);

  return tooltip;
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

  if (recoveryTimeout) {
    clearTimeout(recoveryTimeout);
    recoveryTimeout = undefined;
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

function getPreferredDrink(): string {
  const config = vscode.workspace.getConfiguration('shrimpCheck');
  const rawDrink = config.get<string>('drink', '').trim();
  return rawDrink.length > 0 ? rawDrink : 'caffeine';
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