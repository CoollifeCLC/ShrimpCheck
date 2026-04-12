"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
let statusBarItem;
let warningTimeout;
let cookedTimeout;
let recoveryTimeout;
let hydrationTimeout;
let isEnabled = true;
let currentState = 'ok';
let extensionContext;
function activate(context) {
    extensionContext = context;
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'shrimpCheck.resetPosture';
    context.subscriptions.push(statusBarItem);
    const resetCommand = vscode.commands.registerCommand('shrimpCheck.resetPosture', async () => {
        if (!isEnabled) {
            return;
        }
        if (currentState === 'warning') {
            await handleRecovery();
            return;
        }
        if (currentState === 'cooked') {
            vscode.window.showInformationMessage('🫡 Recovery started. New streak begins now.');
            startCycle();
            return;
        }
        if (currentState === 'recovery') {
            return;
        }
        vscode.window.showInformationMessage('🙂 Timer reset. No shrimp detected yet.');
        startCycle();
    });
    const snoozeCommand = vscode.commands.registerCommand('shrimpCheck.snooze', async () => {
        if (!isEnabled) {
            return;
        }
        clearPostureTimers();
        setStatus('😌 Snoozed', `Current streak: ${getStreak()}. Shrimp Check snoozed for 5 minutes.`, undefined, undefined);
        const selection = await vscode.window.showInformationMessage('😌 Shrimp Check snoozed for 5 minutes.', 'I’m up 😅');
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
        const current = config.get('enabled', true);
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
    context.subscriptions.push(resetCommand, snoozeCommand, toggleCommand, hydrationMenuCommand, configListener);
    refreshFromConfig();
}
function refreshFromConfig() {
    const config = vscode.workspace.getConfiguration('shrimpCheck');
    isEnabled = config.get('enabled', true);
    clearAllTimers();
    if (!isEnabled) {
        currentState = 'ok';
        setStatus('🚫 Shrimp Off', 'Shrimp Check is disabled.', undefined, undefined);
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
    setStatus('🙂 Posture OK', `Current streak: ${getStreak()}. Shrimp Check is watching your spine. Click to reset.`, undefined, undefined);
    warningTimeout = setTimeout(async () => {
        currentState = 'warning';
        setStatus('🟡 Shrimp forming...', `Current streak: ${getStreak()}. You’re about to get cooked. Check your posture.`, undefined, new vscode.ThemeColor('statusBarItem.warningForeground'));
        if (showPopup) {
            const selection = await vscode.window.showWarningMessage('🟡 Shrimp forming... you’re about to get cooked. Check your posture.', 'I’m up 😅', 'Give me 5 min');
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
async function handleRecovery() {
    clearPostureTimers();
    currentState = 'recovery';
    await incrementStreak();
    setStatus('🦐 Un-Shrimp', `Streak: ${getStreak()}. You corrected in time.`, undefined, new vscode.ThemeColor('statusBarItem.prominentForeground'));
    vscode.window.showInformationMessage(`🦐 Un-shrimped. Streak: ${getStreak()}`);
    recoveryTimeout = setTimeout(() => {
        startCycle();
    }, 2000);
}
async function handleCookedState(showPopup) {
    clearPostureTimers();
    currentState = 'cooked';
    await resetStreak();
    setStatus('🍤 Cooked', 'You ignored the shrimp too long. Streak broken. Stand up and stretch.', new vscode.ThemeColor('statusBarItem.errorBackground'), new vscode.ThemeColor('statusBarItem.errorForeground'));
    if (!showPopup) {
        return;
    }
    const selection = await vscode.window.showErrorMessage('🍤 You ignored the shrimp too long. Streak broken. Stand up and stretch.', 'I’m up 😅', 'Give me 5 min');
    if (selection === 'I’m up 😅') {
        vscode.window.showInformationMessage('🫡 Back on your feet. New cycle started.');
        startCycle();
        return;
    }
    if (selection === 'Give me 5 min') {
        await vscode.commands.executeCommand('shrimpCheck.snooze');
    }
}
function startHydrationCycle() {
    if (hydrationTimeout) {
        clearTimeout(hydrationTimeout);
        hydrationTimeout = undefined;
    }
    const config = vscode.workspace.getConfiguration('shrimpCheck');
    const hydrationEnabled = config.get('hydrationEnabled', false);
    const hydrationMinutes = config.get('hydrationMinutes', 45);
    if (!hydrationEnabled) {
        return;
    }
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
    if (!selection) {
        return;
    }
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
function setStatus(text, tooltip, backgroundColor, foregroundColor) {
    statusBarItem.text = text;
    statusBarItem.tooltip = tooltip;
    statusBarItem.backgroundColor = backgroundColor;
    statusBarItem.color = foregroundColor;
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
//# sourceMappingURL=extension.js.map