"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__testing = void 0;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const STATUS_ICONS = {
    ok: '$(shrimp-ok)',
    warning: '$(shrimp-warning)',
    cooked: '$(shrimp-cooked)'
};
const SNOOZE_MINUTES = 5;
const SNOOZE_MS = SNOOZE_MINUTES * 60000;
const TRUSTED_TOOLTIP_COMMANDS = [
    'shrimpCheck.openQuickMenu',
    'shrimpCheck.resetPosture',
    'shrimpCheck.snooze',
    'shrimpCheck.timerMenu',
    'shrimpCheck.hydrationMenu',
    'shrimpCheck.openSettings'
];
let statusBarItem;
let warningTimeout;
let cookedTimeout;
let recoveryTimeout;
let snoozeTimeout;
let hydrationTimeout;
let isEnabled = true;
let currentState = 'ok';
let extensionContext;
function activate(context) {
    extensionContext = context;
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'shrimpCheck.openQuickMenu';
    context.subscriptions.push(statusBarItem);
    const quickMenuCommand = vscode.commands.registerCommand('shrimpCheck.openQuickMenu', async () => {
        await showQuickMenu();
    });
    const resetCommand = vscode.commands.registerCommand('shrimpCheck.resetPosture', async () => {
        if (!isEnabled)
            return;
        if (currentState === 'warning') {
            await handleRecovery();
            return;
        }
        if (currentState === 'cooked') {
            vscode.window.showInformationMessage('🫡 Recovery started. New streak begins now.');
            startCycle();
            return;
        }
        if (currentState === 'recovery')
            return;
        vscode.window.showInformationMessage('🙂 Timer reset. No shrimp detected yet.');
        startCycle();
    });
    const snoozeCommand = vscode.commands.registerCommand('shrimpCheck.snooze', async () => {
        if (!isEnabled)
            return;
        const stateBeforeSnooze = currentState;
        clearPostureTimers();
        currentState = 'snoozed';
        setStatus('😌 Snoozed', `Shrimp Check snoozed for ${SNOOZE_MINUTES} minutes.`);
        const selection = await vscode.window.showInformationMessage(`😌 Shrimp Check snoozed for ${SNOOZE_MINUTES} minutes.`, 'I’m up 😅');
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
        const current = config.get('enabled', true);
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
    const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('shrimpCheck')) {
            refreshFromConfig();
        }
    });
    context.subscriptions.push(quickMenuCommand, resetCommand, snoozeCommand, toggleCommand, hydrationMenuCommand, timerMenuCommand, openSettingsCommand, configListener);
    refreshFromConfig();
}
function refreshFromConfig() {
    const config = vscode.workspace.getConfiguration('shrimpCheck');
    isEnabled = config.get('enabled', true);
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
function startCycle() {
    clearPostureTimers();
    currentState = 'ok';
    const config = vscode.workspace.getConfiguration('shrimpCheck');
    const minMinutes = config.get('minMinutes', 30);
    const maxMinutes = config.get('maxMinutes', 45);
    const warningFraction = config.get('warningFraction', 0.66);
    const showPopup = config.get('showPopup', true);
    const cookedDelayMinutes = config.get('cookedDelayMinutes', 10);
    const safeMin = Math.max(1, minMinutes);
    const safeMax = Math.max(safeMin, maxMinutes);
    const safeCookedDelay = Math.max(1, cookedDelayMinutes);
    const totalMs = randomBetween(safeMin * 60000, safeMax * 60000);
    const warningMs = Math.floor(totalMs * warningFraction);
    const cookedMs = safeCookedDelay * 60000;
    setStatus(`${STATUS_ICONS.ok} Posture OK`, `Current streak: ${getStreak()}. Monitoring posture… stay sharp 🦐 Click for quick settings.`);
    warningTimeout = setTimeout(async () => {
        warningTimeout = undefined;
        currentState = 'warning';
        setStatus(`${STATUS_ICONS.warning} Shrimp forming...`, `Current streak: ${getStreak()}. You may or may not be a shrimp right now 🦐…`, undefined, new vscode.ThemeColor('statusBarItem.warningForeground'));
        cookedTimeout = setTimeout(async () => {
            await handleCookedState(showPopup);
        }, cookedMs);
        if (showPopup) {
            const selection = await vscode.window.showWarningMessage('🟡 You may or may not be a shrimp right now 🦐… Check your posture.', 'I’m up 😅', 'Give me 5 min');
            if (currentState !== 'warning')
                return;
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
async function handleRecovery() {
    clearPostureTimers();
    currentState = 'recovery';
    await incrementStreak();
    setStatus(`${STATUS_ICONS.ok} Un-Shrimp`, `Streak: ${getStreak()}. You corrected in time.`, undefined, new vscode.ThemeColor('statusBarItem.prominentForeground'));
    vscode.window.showInformationMessage(`🦐 Un-shrimped. Streak: ${getStreak()}`);
    recoveryTimeout = setTimeout(() => {
        startCycle();
    }, 2000);
}
async function handleCookedState(showPopup) {
    clearPostureTimers();
    currentState = 'cooked';
    await resetStreak();
    const cookedMessage = '🍤 The shrimp may have gotten the best of you this time… Streak reset. Let’s stand up and recover.';
    setStatus(`${STATUS_ICONS.cooked} Cooked`, cookedMessage, new vscode.ThemeColor('statusBarItem.errorBackground'), new vscode.ThemeColor('statusBarItem.errorForeground'));
    if (!showPopup)
        return;
    const selection = await vscode.window.showErrorMessage(cookedMessage, 'I’m up 😅', 'Give me 5 min');
    if (currentState !== 'cooked')
        return;
    if (selection === 'I’m up 😅') {
        vscode.window.showInformationMessage('🫡 Back on your feet. New cycle started.');
        startCycle();
        return;
    }
    if (selection === 'Give me 5 min') {
        await vscode.commands.executeCommand('shrimpCheck.snooze');
    }
}
async function showQuickMenu() {
    const config = vscode.workspace.getConfiguration('shrimpCheck');
    const enabled = config.get('enabled', true);
    const minMinutes = config.get('minMinutes', 30);
    const maxMinutes = config.get('maxMinutes', 45);
    const cookedDelayMinutes = config.get('cookedDelayMinutes', 10);
    const hydrationEnabled = config.get('hydrationEnabled', false);
    const selection = await vscode.window.showQuickPick([
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
    ], {
        placeHolder: 'Shrimp Check quick settings 🦐'
    });
    if (!selection)
        return;
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
async function showTimerMenu() {
    const config = vscode.workspace.getConfiguration('shrimpCheck');
    const selection = await vscode.window.showQuickPick([
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
    ], {
        placeHolder: 'Choose Shrimp Check timer duration'
    });
    if (!selection)
        return;
    if (selection.label === 'Custom timer range') {
        const input = await vscode.window.showInputBox({
            prompt: 'Enter min and max minutes separated by a dash',
            placeHolder: 'Example: 25-40'
        });
        if (!input)
            return;
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
    vscode.window.showInformationMessage(`🦐 Posture timer set to ${selection.min}-${selection.max} minutes.`);
    refreshFromConfig();
}
async function showCookedDelayMenu() {
    const config = vscode.workspace.getConfiguration('shrimpCheck');
    const selection = await vscode.window.showQuickPick([
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
    ], {
        placeHolder: 'How long after warning before cooked mode?'
    });
    if (!selection)
        return;
    if (selection.label === 'Custom delay') {
        const input = await vscode.window.showInputBox({
            prompt: 'Enter cooked delay in minutes',
            placeHolder: 'Example: 10'
        });
        if (!input)
            return;
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
function startHydrationCycle() {
    if (hydrationTimeout) {
        clearTimeout(hydrationTimeout);
        hydrationTimeout = undefined;
    }
    const config = vscode.workspace.getConfiguration('shrimpCheck');
    const hydrationEnabled = config.get('hydrationEnabled', false);
    const hydrationMinutes = config.get('hydrationMinutes', 45);
    if (!hydrationEnabled)
        return;
    const safeHydrationMinutes = Math.max(1, hydrationMinutes);
    hydrationTimeout = setTimeout(async () => {
        const selection = await vscode.window.showInformationMessage(`💧 Hydration check! Drink some water before you become 70% ${getPreferredDrink()}.`, 'Hydrated ✅', 'Later', 'Hydration Settings');
        if (selection === 'Hydrated ✅') {
            vscode.window.showInformationMessage('💧 Nice. Stay hydrated.');
        }
        else if (selection === 'Hydration Settings') {
            await vscode.commands.executeCommand('shrimpCheck.hydrationMenu');
        }
        startHydrationCycle();
    }, safeHydrationMinutes * 60000);
}
async function showHydrationMenu() {
    const config = vscode.workspace.getConfiguration('shrimpCheck');
    const hydrationEnabled = config.get('hydrationEnabled', false);
    const hydrationMinutes = config.get('hydrationMinutes', 45);
    const selection = await vscode.window.showQuickPick([
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
    ], {
        placeHolder: 'Manage hydration reminders'
    });
    if (!selection)
        return;
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
                vscode.window.showInformationMessage(`💧 Drink preference set to ${trimmed || 'caffeine'}.`);
            }
            break;
        }
        case 'Test hydration notification now':
            await vscode.window.showInformationMessage(`💧 Hydration check! Drink some water before you become 70% ${getPreferredDrink()}.`);
            break;
    }
    refreshFromConfig();
}
function setStatus(text, tooltipText, backgroundColor, foregroundColor) {
    statusBarItem.text = text;
    statusBarItem.tooltip = createShrimpTooltip(tooltipText);
    statusBarItem.backgroundColor = backgroundColor;
    statusBarItem.color = foregroundColor;
    statusBarItem.accessibilityInformation = {
        label: `Shrimp Check: ${getStateLabel()}. ${tooltipText}`
    };
}
function createShrimpTooltip(message) {
    const config = vscode.workspace.getConfiguration('shrimpCheck');
    const minMinutes = config.get('minMinutes', 30);
    const maxMinutes = config.get('maxMinutes', 45);
    const cookedDelayMinutes = config.get('cookedDelayMinutes', 10);
    const hydrationEnabled = config.get('hydrationEnabled', false);
    const hydrationMinutes = config.get('hydrationMinutes', 45);
    const showPopup = config.get('showPopup', true);
    const enabled = config.get('enabled', true);
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
    tooltip.appendMarkdown(`- ${hydrationEnabled ? '☑' : '☐'} **Hydration:** ${hydrationEnabled ? `Every ${hydrationMinutes} min` : 'Off'}\n\n`);
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
function clearPostureTimers() {
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
function clearAllTimers() {
    clearPostureTimers();
    if (hydrationTimeout) {
        clearTimeout(hydrationTimeout);
        hydrationTimeout = undefined;
    }
}
function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function getStreak() {
    return extensionContext.globalState.get('shrimpCheck.streak', 0);
}
function getPreferredDrink() {
    const config = vscode.workspace.getConfiguration('shrimpCheck');
    const rawDrink = config.get('drink', '').trim();
    return rawDrink.length > 0 ? rawDrink : 'caffeine';
}
function getStateLabel() {
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
function getStateIcon() {
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
function getEffectiveConfigurationTarget(config, key) {
    const inspected = config.inspect(key);
    if (inspected?.workspaceFolderValue !== undefined) {
        return vscode.ConfigurationTarget.WorkspaceFolder;
    }
    if (inspected?.workspaceValue !== undefined) {
        return vscode.ConfigurationTarget.Workspace;
    }
    return vscode.ConfigurationTarget.Global;
}
async function updateShrimpConfig(config, key, value) {
    await config.update(key, value, getEffectiveConfigurationTarget(config, key));
}
async function incrementStreak() {
    const streak = getStreak() + 1;
    await extensionContext.globalState.update('shrimpCheck.streak', streak);
}
async function resetStreak() {
    await extensionContext.globalState.update('shrimpCheck.streak', 0);
}
function deactivate() {
    clearAllTimers();
}
exports.__testing = {
    SNOOZE_MINUTES,
    SNOOZE_MS,
    clearAllTimers,
    getCurrentState: () => currentState,
    getEffectiveConfigurationTarget,
    refreshFromConfig,
    startCycle
};
//# sourceMappingURL=extension.js.map