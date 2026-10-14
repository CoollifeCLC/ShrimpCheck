import * as vscode from 'vscode';
import { ChallengeController } from './challenges/controller';
import {
  CHALLENGE_KEYS,
  INTERVIEW_SPRINT_PRESET,
  readChallengeSettings
} from './challenges/settings';
import {
  CATEGORY_LABELS,
  CORE_CATEGORIES,
  ChallengeCategory,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  PRACTICAL_CATEGORIES
} from './challenges/types';

type ShrimpState = 'ok' | 'warning' | 'recovery' | 'cooked' | 'snoozed';

const STATUS_ICONS = {
  ok: '$(shrimp-ok)',
  warning: '$(shrimp-warning)',
  cooked: '$(shrimp-cooked)'
};
const SNOOZE_MINUTES = 5;
const SNOOZE_MS = SNOOZE_MINUTES * 60_000;
const CHALLENGE_LATER_MINUTES = 10;
const CHALLENGE_LATER_MS = CHALLENGE_LATER_MINUTES * 60_000;
const TRUSTED_TOOLTIP_COMMANDS = [
  'shrimpCheck.openQuickMenu',
  'shrimpCheck.resetPosture',
  'shrimpCheck.snooze',
  'shrimpCheck.timerMenu',
  'shrimpCheck.hydrationMenu',
  'shrimpCheck.openSettings',
  'shrimpCheck.challengeMenu',
  'shrimpCheck.startChallenge'
];

let statusBarItem: vscode.StatusBarItem;

let warningTimeout: ReturnType<typeof setTimeout> | undefined;
let cookedTimeout: ReturnType<typeof setTimeout> | undefined;
let recoveryTimeout: ReturnType<typeof setTimeout> | undefined;
let snoozeTimeout: ReturnType<typeof setTimeout> | undefined;
let hydrationTimeout: ReturnType<typeof setTimeout> | undefined;
let challengeTimeout: ReturnType<typeof setTimeout> | undefined;

let isEnabled = true;
let currentState: ShrimpState = 'ok';
let extensionContext: vscode.ExtensionContext;
let challengeController: ChallengeController | undefined;
let lastStatusMessage = '';

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'shrimpCheck.openQuickMenu';
  context.subscriptions.push(statusBarItem);

  challengeController = new ChallengeController(context, () => refreshStatusTooltip());
  context.subscriptions.push(challengeController);

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

    const stateBeforeSnooze = currentState;
    clearPostureTimers();
    currentState = 'snoozed';

    setStatus('😌 Snoozed', `Shrimp Check snoozed for ${SNOOZE_MINUTES} minutes.`);

    const selection = await vscode.window.showInformationMessage(
      `😌 Shrimp Check snoozed for ${SNOOZE_MINUTES} minutes.`,
      'I’m up 😅'
    );

    if (selection === 'I’m up 😅') {
      if (stateBeforeSnooze === 'warning') {
        await handleRecovery();
        return;
      }

      startCycle();
      return;
    }

    snoozeTimeout = setTimeout(() => {
      startCycle();
    }, SNOOZE_MS);
  });

  const toggleCommand = vscode.commands.registerCommand('shrimpCheck.toggle', async () => {
    const config = vscode.workspace.getConfiguration('shrimpCheck');
    const current = config.get<boolean>('enabled', true);
    await updateShrimpConfig(config, 'enabled', !current);
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

  const challengeMenuCommand = vscode.commands.registerCommand('shrimpCheck.challengeMenu', async () => {
    await showChallengeMenu();
  });

  const startChallengeCommand = vscode.commands.registerCommand('shrimpCheck.startChallenge', async () => {
    await startChallengeNow();
  });

  const resumeChallengeCommand = vscode.commands.registerCommand('shrimpCheck.resumeChallenge', async () => {
    if (!challengeController?.hasActiveSession()) {
      vscode.window.showInformationMessage('🧠 No challenge in progress. Start one from the Challenge Mode menu.');
      return;
    }
    await challengeController.resume();
  });

  const challengeStatsCommand = vscode.commands.registerCommand('shrimpCheck.challengeStats', () => {
    challengeController?.showStats();
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
    challengeMenuCommand,
    startChallengeCommand,
    resumeChallengeCommand,
    challengeStatsCommand,
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
  startChallengeCycle();
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
    `${STATUS_ICONS.ok} Posture OK`,
    `Current streak: ${getStreak()}. Monitoring posture… stay sharp 🦐 Click for quick settings.`
  );

  warningTimeout = setTimeout(async () => {
    warningTimeout = undefined;
    currentState = 'warning';

    setStatus(
      `${STATUS_ICONS.warning} Shrimp forming...`,
      `Current streak: ${getStreak()}. You may or may not be a shrimp right now 🦐…`,
      undefined,
      new vscode.ThemeColor('statusBarItem.warningForeground')
    );

    cookedTimeout = setTimeout(async () => {
      await handleCookedState(showPopup);
    }, cookedMs);

    if (showPopup) {
      const selection = await vscode.window.showWarningMessage(
        '🟡 You may or may not be a shrimp right now 🦐… Check your posture.',
        'I’m up 😅',
        'Give me 5 min'
      );

      if (currentState !== 'warning') return;

      if (selection === 'I’m up 😅') {
        await handleRecovery();
        return;
      }

      if (selection === 'Give me 5 min') {
        await vscode.commands.executeCommand('shrimpCheck.snooze');
      }
    }
  }, warningMs);
}

async function handleRecovery(): Promise<void> {
  clearPostureTimers();
  currentState = 'recovery';
  await incrementStreak();

  setStatus(
    `${STATUS_ICONS.ok} Un-Shrimp`,
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
    `${STATUS_ICONS.cooked} Cooked`,
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

  if (currentState !== 'cooked') return;

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
  const challengeSettings = readChallengeSettings(config);

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
        label: 'Challenge Mode',
        description: challengeController?.activeChallenge
          ? `In progress: ${challengeController.activeChallenge.title}`
          : challengeSettings.enabled
            ? `Every ${challengeSettings.intervalMinutes} minutes`
            : 'Currently Off'
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

    case 'Challenge Mode':
      await showChallengeMenu();
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

    await updateShrimpConfig(config, 'minMinutes', safeMin);
    await updateShrimpConfig(config, 'maxMinutes', safeMax);

    vscode.window.showInformationMessage(`🦐 Posture timer set to ${safeMin}-${safeMax} minutes.`);
    refreshFromConfig();
    return;
  }

  await updateShrimpConfig(config, 'minMinutes', selection.min);
  await updateShrimpConfig(config, 'maxMinutes', selection.max);

  vscode.window.showInformationMessage(
    `🦐 Posture timer set to ${selection.min}-${selection.max} minutes.`
  );

  refreshFromConfig();
}

async function showCookedDelayMenu(): Promise<void> {
  const config = vscode.workspace.getConfiguration('shrimpCheck');

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

    await updateShrimpConfig(config, 'cookedDelayMinutes', safeDelay);
    vscode.window.showInformationMessage(`🍤 Cooked delay set to ${safeDelay} minutes.`);
    refreshFromConfig();
    return;
  }

  await updateShrimpConfig(config, 'cookedDelayMinutes', selection.value);
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

  switch (selection.label) {
    case 'Enable Hydration Checks':
      await updateShrimpConfig(config, 'hydrationEnabled', true);
      vscode.window.showInformationMessage('💧 Hydration checks enabled.');
      break;

    case 'Disable Hydration Checks':
      await updateShrimpConfig(config, 'hydrationEnabled', false);
      vscode.window.showInformationMessage('💧 Hydration checks disabled.');
      break;

    case 'Set hydration to 15 minutes':
      await updateShrimpConfig(config, 'hydrationMinutes', 15);
      vscode.window.showInformationMessage('💧 Hydration timer set to 15 minutes.');
      break;

    case 'Set hydration to 30 minutes':
      await updateShrimpConfig(config, 'hydrationMinutes', 30);
      vscode.window.showInformationMessage('💧 Hydration timer set to 30 minutes.');
      break;

    case 'Set hydration to 45 minutes':
      await updateShrimpConfig(config, 'hydrationMinutes', 45);
      vscode.window.showInformationMessage('💧 Hydration timer set to 45 minutes.');
      break;

    case 'Set hydration to 60 minutes':
      await updateShrimpConfig(config, 'hydrationMinutes', 60);
      vscode.window.showInformationMessage('💧 Hydration timer set to 60 minutes.');
      break;

    case 'Set custom drink': {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter your preferred coding beverage',
        placeHolder: 'coffee, tea, matcha, energy drink...'
      });

      if (input !== undefined) {
        const trimmed = input.trim();
        await updateShrimpConfig(config, 'drink', trimmed);
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
  lastStatusMessage = tooltipText;
  statusBarItem.text = text;
  statusBarItem.tooltip = createShrimpTooltip(tooltipText);
  statusBarItem.backgroundColor = backgroundColor;
  statusBarItem.color = foregroundColor;
  statusBarItem.accessibilityInformation = {
    label: `Shrimp Check: ${getStateLabel()}. ${tooltipText}`
  };
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

  const stateLabel = getStateLabel();
  const stateIcon = getStateIcon();

  const tooltip = new vscode.MarkdownString();
  tooltip.isTrusted = { enabledCommands: TRUSTED_TOOLTIP_COMMANDS };

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

  const challengeSettings = readChallengeSettings(config);
  const activeChallenge = challengeController?.activeChallenge;
  tooltip.appendMarkdown(`**🧠 Challenge Mode**\n\n`);
  tooltip.appendMarkdown(
    `- ${challengeSettings.enabled ? '☑' : '☐'} **Challenges:** ${
      challengeSettings.enabled ? `Every ${challengeSettings.intervalMinutes} min` : 'Off'
    }\n`
  );
  if (activeChallenge) {
    tooltip.appendMarkdown(`- ⏱ **In progress:** ${escapeMarkdown(activeChallenge.title)}\n`);
  }
  tooltip.appendMarkdown(`- ⭐ **Solved:** ${challengeController?.solvedCount() ?? 0}\n\n`);

  tooltip.appendMarkdown(`---\n\n`);

  tooltip.appendMarkdown(`**⚡ Quick Actions**\n\n`);
  tooltip.appendMarkdown(`[Open Quick Menu](command:shrimpCheck.openQuickMenu)  \n`);
  tooltip.appendMarkdown(`[Reset Timer](command:shrimpCheck.resetPosture)  \n`);
  tooltip.appendMarkdown(`[Snooze 5 Min](command:shrimpCheck.snooze)  \n`);
  tooltip.appendMarkdown(
    `[${activeChallenge ? 'Resume Challenge' : 'Start Challenge'}](command:shrimpCheck.startChallenge)\n\n`
  );

  tooltip.appendMarkdown(`**🛠 Settings**\n\n`);
  tooltip.appendMarkdown(`[Adjust Timers](command:shrimpCheck.timerMenu)  \n`);
  tooltip.appendMarkdown(`[Hydration Settings](command:shrimpCheck.hydrationMenu)  \n`);
  tooltip.appendMarkdown(`[Challenge Mode](command:shrimpCheck.challengeMenu)  \n`);
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

  if (snoozeTimeout) {
    clearTimeout(snoozeTimeout);
    snoozeTimeout = undefined;
  }
}

function clearAllTimers(): void {
  clearPostureTimers();

  if (hydrationTimeout) {
    clearTimeout(hydrationTimeout);
    hydrationTimeout = undefined;
  }

  clearChallengeTimer();
}

function clearChallengeTimer(): void {
  if (challengeTimeout) {
    clearTimeout(challengeTimeout);
    challengeTimeout = undefined;
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

function getStateLabel(): string {
  switch (currentState) {
    case 'ok':
      return 'Posture OK';
    case 'warning':
      return 'Shrimp forming';
    case 'recovery':
      return 'Recovering';
    case 'cooked':
      return 'Cooked';
    case 'snoozed':
      return 'Snoozed';
  }
}

function getStateIcon(): string {
  switch (currentState) {
    case 'ok':
      return STATUS_ICONS.ok;
    case 'warning':
      return STATUS_ICONS.warning;
    case 'recovery':
      return STATUS_ICONS.ok;
    case 'cooked':
      return STATUS_ICONS.cooked;
    case 'snoozed':
      return '😌';
  }
}

function getEffectiveConfigurationTarget(
  config: vscode.WorkspaceConfiguration,
  key: string
): vscode.ConfigurationTarget {
  const inspected = config.inspect<unknown>(key);

  if (inspected?.workspaceFolderValue !== undefined) {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }

  if (inspected?.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }

  return vscode.ConfigurationTarget.Global;
}

async function updateShrimpConfig<T>(
  config: vscode.WorkspaceConfiguration,
  key: string,
  value: T
): Promise<void> {
  await config.update(key, value, getEffectiveConfigurationTarget(config, key));
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
  // Kills any running Challenge Mode runner process tree synchronously.
  challengeController?.dispose();
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}\[\]()#+\-.!|<>]/g, '\\$&');
}

function refreshStatusTooltip(): void {
  if (!statusBarItem) return;
  statusBarItem.tooltip = createShrimpTooltip(lastStatusMessage);
}

// ── Challenge Mode ──────────────────────────────────────────────────────────

/**
 * Independent fixed-interval loop, same shape as hydration. It never touches
 * posture state, and it only offers a challenge; nothing opens until the user
 * says Start, so active work is never interrupted destructively.
 */
function startChallengeCycle(delayMs?: number): void {
  clearChallengeTimer();

  const settings = readChallengeSettings(vscode.workspace.getConfiguration('shrimpCheck'));
  if (!isEnabled || !settings.enabled) return;

  challengeTimeout = setTimeout(() => {
    challengeTimeout = undefined;
    void onChallengeDue();
  }, delayMs ?? settings.intervalMinutes * 60_000);
}

async function onChallengeDue(): Promise<void> {
  // Schedule the next regular slot first so an ignored notification never stalls the loop.
  startChallengeCycle();

  if (!challengeController) return;

  if (challengeController.hasActiveSession()) {
    // One challenge at a time; the open one keeps its clock.
    return;
  }

  const challenge = challengeController.pickNext();
  if (!challenge) {
    const selection = await vscode.window.showWarningMessage(
      '🧠 No challenges match your Challenge Mode categories and difficulties.',
      'Challenge Settings'
    );
    if (selection === 'Challenge Settings') await showChallengeMenu();
    return;
  }

  const selection = await vscode.window.showInformationMessage(
    `🧠 Shrimp Challenge ready: ${challenge.title} (${DIFFICULTY_LABELS[challenge.difficulty]} · ${
      CATEGORY_LABELS[challenge.category]
    }). The clock starts when you do.`,
    'Start',
    `In ${CHALLENGE_LATER_MINUTES} min`,
    'Skip'
  );

  if (selection === 'Start') {
    await challengeController.start(challenge);
  } else if (selection === `In ${CHALLENGE_LATER_MINUTES} min`) {
    startChallengeCycle(CHALLENGE_LATER_MS);
  }
}

async function startChallengeNow(): Promise<void> {
  if (!challengeController) return;

  const active = challengeController.activeChallenge;
  if (active) {
    const choice = await vscode.window.showInformationMessage(
      `🧠 "${active.title}" is still in progress.`,
      'Resume',
      'Skip it and start a new one'
    );
    if (choice === 'Resume') {
      await challengeController.resume();
      return;
    }
    if (choice !== 'Skip it and start a new one') return;
    await challengeController.abandon();
  }

  const challenge = challengeController.pickNext();
  if (!challenge) {
    vscode.window.showWarningMessage(
      '🧠 No challenges match your Challenge Mode categories and difficulties.'
    );
    return;
  }

  await challengeController.start(challenge);
}

async function showChallengeMenu(): Promise<void> {
  const config = vscode.workspace.getConfiguration('shrimpCheck');
  const settings = readChallengeSettings(config);
  const active = challengeController?.activeChallenge;
  const th = settings.thresholds;

  const items: vscode.QuickPickItem[] = [
    { label: 'Start a challenge now', description: 'Pick one based on your filters and weak spots' },
    ...(active
      ? [
          { label: 'Resume current challenge', description: active.title },
          { label: 'Skip current challenge', description: 'Logged as unsolved' }
        ]
      : []),
    {
      label: settings.enabled ? 'Disable Challenge Mode' : 'Enable Challenge Mode',
      description: `Currently ${settings.enabled ? 'On' : 'Off'}`
    },
    { label: 'Apply Interview Sprint preset', description: 'Core patterns · Easy + Medium · every 30 min' },
    { label: 'Set challenge frequency', description: `Current: every ${settings.intervalMinutes} minutes` },
    { label: 'Choose categories', description: `${settings.categories.length} selected` },
    {
      label: 'Choose difficulties',
      description: settings.difficulties.map((d) => DIFFICULTY_LABELS[d]).join(' + ') || 'None'
    },
    {
      label: 'Set star timing thresholds',
      description: `★5 ≤${th.five} · ★4 ≤${th.four} · ★3 ≤${th.three} · ★2 ≤${th.two} min`
    },
    {
      label: settings.includePractical ? 'Exclude practical challenges' : 'Include practical challenges',
      description: `API, async, regex… currently ${settings.includePractical ? 'On' : 'Off'}`
    },
    { label: 'View challenge stats', description: 'Solves, speed, streak, category scores' },
    { label: 'Open Challenge Mode settings', description: 'All options in VS Code settings' }
  ];

  const selection = await vscode.window.showQuickPick(items, { placeHolder: 'Shrimp Check Challenge Mode 🧠' });
  if (!selection) return;

  switch (selection.label) {
    case 'Start a challenge now':
      await startChallengeNow();
      return;

    case 'Resume current challenge':
      await challengeController?.resume();
      return;

    case 'Skip current challenge':
      await challengeController?.abandon();
      vscode.window.showInformationMessage('🧠 Challenge skipped. Logged as unsolved.');
      return;

    case 'Enable Challenge Mode':
    case 'Disable Challenge Mode': {
      const next = !settings.enabled;
      await updateShrimpConfig(config, CHALLENGE_KEYS.enabled, next);
      vscode.window.showInformationMessage(
        next
          ? `🧠 Challenge Mode on. First challenge in ${settings.intervalMinutes} minutes.`
          : '🧠 Challenge Mode off.'
      );
      break;
    }

    case 'Apply Interview Sprint preset':
      for (const [key, value] of INTERVIEW_SPRINT_PRESET) {
        await updateShrimpConfig(config, key, value);
      }
      vscode.window.showInformationMessage(
        '🧠 Interview Sprint applied: core patterns, Easy + Medium, every 30 minutes. Every option stays editable.'
      );
      break;

    case 'Set challenge frequency':
      await showChallengeFrequencyMenu(config);
      break;

    case 'Choose categories':
      await showChallengeCategoryPicker(config, settings.categories);
      break;

    case 'Choose difficulties':
      await showChallengeDifficultyPicker(config, settings.difficulties);
      break;

    case 'Set star timing thresholds':
      await showStarThresholdInput(config);
      break;

    case 'Include practical challenges':
    case 'Exclude practical challenges':
      await updateShrimpConfig(config, CHALLENGE_KEYS.includePractical, !settings.includePractical);
      if (!settings.includePractical) {
        const merged = Array.from(new Set<ChallengeCategory>([...settings.categories, ...PRACTICAL_CATEGORIES]));
        await updateShrimpConfig(config, CHALLENGE_KEYS.categories, merged);
      }
      break;

    case 'View challenge stats':
      challengeController?.showStats();
      return;

    case 'Open Challenge Mode settings':
      await vscode.commands.executeCommand('workbench.action.openSettings', 'shrimpCheck.challenge');
      return;
  }

  refreshFromConfig();
}

async function showChallengeFrequencyMenu(config: vscode.WorkspaceConfiguration): Promise<void> {
  const selection = await vscode.window.showQuickPick(
    [
      { label: 'Every 15 minutes', value: 15 },
      { label: 'Every 30 minutes', value: 30 },
      { label: 'Every 60 minutes', value: 60 },
      { label: 'Every 90 minutes', value: 90 },
      { label: 'Custom interval', value: undefined }
    ],
    { placeHolder: 'How often should a challenge be offered?' }
  );
  if (!selection) return;

  let minutes = selection.value;
  if (minutes === undefined) {
    const input = await vscode.window.showInputBox({
      prompt: 'Minutes between challenges',
      placeHolder: 'Example: 45'
    });
    if (!input) return;
    const parsed = Number(input.trim());
    minutes = Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : 60;
  }

  await updateShrimpConfig(config, CHALLENGE_KEYS.intervalMinutes, minutes);
  vscode.window.showInformationMessage(`🧠 Challenges every ${minutes} minutes.`);
}

async function showChallengeCategoryPicker(
  config: vscode.WorkspaceConfiguration,
  current: ChallengeCategory[]
): Promise<void> {
  const selected = new Set(current);
  const items = [
    ...CORE_CATEGORIES.map((category) => ({
      label: CATEGORY_LABELS[category],
      category: category as ChallengeCategory,
      picked: selected.has(category)
    })),
    ...PRACTICAL_CATEGORIES.map((category) => ({
      label: CATEGORY_LABELS[category],
      description: 'Practical',
      category: category as ChallengeCategory,
      picked: selected.has(category)
    }))
  ];

  const picks = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Challenge categories (practical ones also need "Include practical challenges")'
  });
  if (!picks) return;

  if (picks.length === 0) {
    vscode.window.showWarningMessage('🧠 Pick at least one category. Nothing changed.');
    return;
  }

  await updateShrimpConfig(
    config,
    CHALLENGE_KEYS.categories,
    picks.map((pick) => pick.category)
  );
}

async function showChallengeDifficultyPicker(
  config: vscode.WorkspaceConfiguration,
  current: string[]
): Promise<void> {
  const picks = await vscode.window.showQuickPick(
    DIFFICULTIES.map((difficulty) => ({
      label: DIFFICULTY_LABELS[difficulty],
      difficulty,
      picked: current.includes(difficulty)
    })),
    { canPickMany: true, placeHolder: 'Challenge difficulties' }
  );
  if (!picks) return;

  if (picks.length === 0) {
    vscode.window.showWarningMessage('🧠 Pick at least one difficulty. Nothing changed.');
    return;
  }

  await updateShrimpConfig(
    config,
    CHALLENGE_KEYS.difficulties,
    picks.map((pick) => pick.difficulty)
  );
}

async function showStarThresholdInput(config: vscode.WorkspaceConfiguration): Promise<void> {
  const th = readChallengeSettings(config).thresholds;
  const input = await vscode.window.showInputBox({
    prompt: 'Minutes for ★★★★★, ★★★★, ★★★, ★★ (comma separated, increasing). Slower correct solves get ★.',
    value: `${th.five}, ${th.four}, ${th.three}, ${th.two}`,
    validateInput: (value) => {
      const parts = value.split(',').map((part) => Number(part.trim()));
      if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part <= 0)) {
        return 'Enter four positive numbers, e.g. 10, 15, 20, 30';
      }
      for (let i = 1; i < parts.length; i += 1) {
        if (parts[i] < parts[i - 1]) return 'Each threshold must be at least the one before it';
      }
      return undefined;
    }
  });
  if (!input) return;

  const [five, four, three, two] = input.split(',').map((part) => Number(part.trim()));
  await updateShrimpConfig(config, CHALLENGE_KEYS.fiveStarMinutes, five);
  await updateShrimpConfig(config, CHALLENGE_KEYS.fourStarMinutes, four);
  await updateShrimpConfig(config, CHALLENGE_KEYS.threeStarMinutes, three);
  await updateShrimpConfig(config, CHALLENGE_KEYS.twoStarMinutes, two);
  vscode.window.showInformationMessage(`🧠 Star thresholds: ${five} / ${four} / ${three} / ${two} minutes.`);
}

export const __testing = {
  SNOOZE_MINUTES,
  SNOOZE_MS,
  clearAllTimers,
  getCurrentState: () => currentState,
  getChallengeController: () => challengeController,
  hasChallengeTimer: () => challengeTimeout !== undefined,
  startChallengeCycle,
  getEffectiveConfigurationTarget,
  refreshFromConfig,
  startCycle
};
