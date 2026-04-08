# Shrimp Check 🦐

A playful VS Code extension that reminds you to fix your posture before you evolve into a full crustacean.

## Features

- Random posture reminder every 30–45 minutes
- Status bar posture indicator
- Warning state before full shrimp mode
- Click the status bar item to reset your timer
- Snooze option for 10 minutes
- Enable/disable support from settings

## States

- 🙂 **Posture OK**
- 🟡 **Shrimp forming...**
- 🦐 **Un-shrimp**

## Commands

- `Shrimp Check: Reset Posture Timer`
- `Shrimp Check: Snooze 10 Minutes`
- `Shrimp Check: Enable/Disable`

## Extension Settings

This extension contributes the following settings:

- `shrimpCheck.enabled`
- `shrimpCheck.minMinutes`
- `shrimpCheck.maxMinutes`
- `shrimpCheck.warningFraction`
- `shrimpCheck.showPopup`

## Development

```bash
npm install
npm run compile