const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map();

  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    pending() {
      return Array.from(timers, ([id, timer]) => ({ id, delay: timer.delay }));
    },
    async fireByDelay(delay) {
      const match = this.pending().find((timer) => timer.delay === delay);
      assert.ok(match, `Expected pending timer with delay ${delay}`);

      const timer = timers.get(match.id);
      timers.delete(match.id);
      await timer.callback();
    }
  };
}

function createVscodeMock(initialSettings = {}) {
  const defaults = {
    enabled: true,
    minMinutes: 30,
    maxMinutes: 45,
    warningFraction: 0.66,
    showPopup: true,
    cookedDelayMinutes: 10,
    hydrationEnabled: false,
    hydrationMinutes: 45,
    drink: ''
  };

  const values = {
    global: { ...initialSettings },
    workspace: {},
    workspaceFolder: {}
  };

  const calls = {
    errorMessages: [],
    infoMessages: [],
    updates: [],
    warningMessages: []
  };

  const responses = {
    info: [],
    input: [],
    quickPick: [],
    warning: [],
    error: []
  };

  const commands = new Map();
  const statusBarItems = [];

  const config = {
    get(key, fallback) {
      if (Object.prototype.hasOwnProperty.call(values.workspaceFolder, key)) {
        return values.workspaceFolder[key];
      }

      if (Object.prototype.hasOwnProperty.call(values.workspace, key)) {
        return values.workspace[key];
      }

      if (Object.prototype.hasOwnProperty.call(values.global, key)) {
        return values.global[key];
      }

      return Object.prototype.hasOwnProperty.call(defaults, key) ? defaults[key] : fallback;
    },
    inspect(key) {
      return {
        defaultValue: defaults[key],
        globalValue: values.global[key],
        workspaceValue: values.workspace[key],
        workspaceFolderValue: values.workspaceFolder[key]
      };
    },
    async update(key, value, target) {
      calls.updates.push({ key, value, target });

      if (target === 3) {
        values.workspaceFolder[key] = value;
      } else if (target === 2) {
        values.workspace[key] = value;
      } else {
        values.global[key] = value;
      }
    }
  };

  const vscode = {
    ConfigurationTarget: {
      Global: 1,
      Workspace: 2,
      WorkspaceFolder: 3
    },
    StatusBarAlignment: {
      Right: 2
    },
    ThemeColor: class ThemeColor {
      constructor(id) {
        this.id = id;
      }
    },
    MarkdownString: class MarkdownString {
      constructor() {
        this.value = '';
      }

      appendMarkdown(markdown) {
        this.value += markdown;
      }
    },
    commands: {
      registerCommand(command, callback) {
        commands.set(command, callback);
        return { dispose() {} };
      },
      async executeCommand(command, ...args) {
        const callback = commands.get(command);
        return callback ? callback(...args) : undefined;
      }
    },
    window: {
      createStatusBarItem() {
        const item = {
          showCalled: false,
          show() {
            this.showCalled = true;
          }
        };
        statusBarItems.push(item);
        return item;
      },
      async showQuickPick(items) {
        const response = responses.quickPick.shift();
        if (typeof response === 'string') {
          return items.find((item) => item.label === response);
        }

        return response;
      },
      async showInputBox() {
        return responses.input.shift();
      },
      async showInformationMessage(message) {
        calls.infoMessages.push(message);
        return responses.info.shift();
      },
      async showWarningMessage(message) {
        calls.warningMessages.push(message);
        return responses.warning.shift();
      },
      async showErrorMessage(message) {
        calls.errorMessages.push(message);
        return responses.error.shift();
      }
    },
    workspace: {
      getConfiguration(section) {
        assert.equal(section, 'shrimpCheck');
        return config;
      },
      onDidChangeConfiguration() {
        return { dispose() {} };
      }
    }
  };

  return { calls, config, responses, statusBarItems, values, vscode };
}

function createContext() {
  const store = new Map();

  return {
    subscriptions: [],
    globalState: {
      get(key, fallback) {
        return store.has(key) ? store.get(key) : fallback;
      },
      async update(key, value) {
        store.set(key, value);
      }
    }
  };
}

function loadExtension(t, initialSettings = {}) {
  const timers = createFakeTimers();
  const mock = createVscodeMock(initialSettings);
  const extensionPath = path.resolve(__dirname, '..', 'out', 'extension.js');

  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalLoad = Module._load;

  global.setTimeout = timers.setTimeout.bind(timers);
  global.clearTimeout = timers.clearTimeout.bind(timers);
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') {
      return mock.vscode;
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[extensionPath];
  const extension = require(extensionPath);

  t.after(() => {
    extension.deactivate();
    delete require.cache[extensionPath];
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    Module._load = originalLoad;
  });

  const context = createContext();
  extension.activate(context);

  return { context, extension, mock, timers };
}

test('cooked delay is scheduled only after warning fires', async (t) => {
  const { extension, mock, timers } = loadExtension(t, {
    cookedDelayMinutes: 5,
    maxMinutes: 30,
    minMinutes: 30,
    showPopup: false,
    warningFraction: 0.5
  });

  assert.deepEqual(
    timers.pending().map((timer) => timer.delay),
    [15 * 60_000]
  );

  await timers.fireByDelay(15 * 60_000);
  assert.equal(extension.__testing.getCurrentState(), 'warning');
  assert.equal(mock.statusBarItems[0].text, '$(shrimp-warning) Shrimp forming...');
  assert.equal(mock.calls.warningMessages.length, 0);

  assert.deepEqual(
    timers.pending().map((timer) => timer.delay),
    [5 * 60_000]
  );

  await timers.fireByDelay(5 * 60_000);
  assert.equal(extension.__testing.getCurrentState(), 'cooked');
  assert.equal(mock.statusBarItems[0].text, '$(shrimp-cooked) Cooked');
  assert.equal(mock.calls.errorMessages.length, 0);
});

test('stale warning responses cannot recover after cooked state wins', async (t) => {
  const { extension, mock, timers } = loadExtension(t, {
    cookedDelayMinutes: 5,
    maxMinutes: 30,
    minMinutes: 30,
    warningFraction: 0.5
  });

  let resolveWarning;
  mock.responses.warning.push(
    new Promise((resolve) => {
      resolveWarning = resolve;
    })
  );

  const warningRun = timers.fireByDelay(15 * 60_000);
  await timers.fireByDelay(5 * 60_000);

  assert.equal(extension.__testing.getCurrentState(), 'cooked');
  resolveWarning('I’m up 😅');
  await warningRun;
  assert.equal(extension.__testing.getCurrentState(), 'cooked');
});

test('snooze uses one duration, state, and timer', async (t) => {
  const { extension, mock, timers } = loadExtension(t);

  await mock.vscode.commands.executeCommand('shrimpCheck.snooze');

  assert.equal(extension.__testing.getCurrentState(), 'snoozed');
  assert.equal(mock.statusBarItems[0].text, '😌 Snoozed');
  assert.match(mock.calls.infoMessages[0], /5 minutes/);
  assert.deepEqual(
    timers.pending().map((timer) => timer.delay),
    [extension.__testing.SNOOZE_MS]
  );

  await timers.fireByDelay(extension.__testing.SNOOZE_MS);
  assert.equal(extension.__testing.getCurrentState(), 'ok');
});

test('acknowledging while snoozing from warning preserves recovery behavior', async (t) => {
  const { context, extension, mock, timers } = loadExtension(t, {
    maxMinutes: 30,
    minMinutes: 30,
    showPopup: false,
    warningFraction: 0.5
  });

  await timers.fireByDelay(15 * 60_000);
  mock.responses.info.push('I’m up 😅');

  await mock.vscode.commands.executeCommand('shrimpCheck.snooze');

  assert.equal(extension.__testing.getCurrentState(), 'recovery');
  assert.equal(context.globalState.get('shrimpCheck.streak', 0), 1);
  assert.deepEqual(
    timers.pending().map((timer) => timer.delay),
    [2000]
  );
});

test('menu setting writes update the effective workspace target', async (t) => {
  const { mock } = loadExtension(t);
  mock.values.workspace.minMinutes = 20;
  mock.values.workspace.maxMinutes = 35;
  mock.responses.quickPick.push('Deep work: 45-60 minutes');

  await mock.vscode.commands.executeCommand('shrimpCheck.timerMenu');

  assert.deepEqual(mock.calls.updates.slice(0, 2), [
    { key: 'minMinutes', value: 45, target: mock.vscode.ConfigurationTarget.Workspace },
    { key: 'maxMinutes', value: 60, target: mock.vscode.ConfigurationTarget.Workspace }
  ]);
  assert.equal(mock.config.get('minMinutes'), 45);
  assert.equal(mock.config.get('maxMinutes'), 60);
});

test('status tooltip trust and accessibility metadata are scoped', (t) => {
  const { mock } = loadExtension(t);
  const item = mock.statusBarItems[0];

  assert.match(item.accessibilityInformation.label, /^Shrimp Check: Posture OK\./);
  assert.deepEqual(item.tooltip.isTrusted, {
    enabledCommands: [
      'shrimpCheck.openQuickMenu',
      'shrimpCheck.resetPosture',
      'shrimpCheck.snooze',
      'shrimpCheck.timerMenu',
      'shrimpCheck.hydrationMenu',
      'shrimpCheck.openSettings'
    ]
  });
  assert.equal(item.tooltip.supportHtml, undefined);
});

test('package metadata matches supported setting floors and snooze label', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')
  );
  const icons = packageJson.contributes.icons;
  const properties = packageJson.contributes.configuration.properties;
  const snoozeCommand = packageJson.contributes.commands.find(
    (command) => command.command === 'shrimpCheck.snooze'
  );

  assert.equal(snoozeCommand.title, 'Shrimp Check: Snooze');
  assert.equal(icons['shrimp-ok'].default.fontPath, './media/shrimp-check-icons.woff');
  assert.equal(icons['shrimp-ok'].default.fontCharacter, '\\E001');
  assert.equal(icons['shrimp-warning'].default.fontPath, './media/shrimp-check-icons.woff');
  assert.equal(icons['shrimp-warning'].default.fontCharacter, '\\E001');
  assert.equal(icons['shrimp-cooked'].default.fontPath, './media/shrimp-check-icons.woff');
  assert.equal(icons['shrimp-cooked'].default.fontCharacter, '\\E001');
  assert.equal(properties['shrimpCheck.minMinutes'].minimum, 1);
  assert.equal(properties['shrimpCheck.maxMinutes'].minimum, 1);
  assert.equal(properties['shrimpCheck.cookedDelayMinutes'].minimum, 1);
  assert.equal(properties['shrimpCheck.hydrationMinutes'].minimum, 1);
});
