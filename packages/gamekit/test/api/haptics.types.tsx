import { createGameHaptics } from 'rn-gamekit/haptics';
import type { HapticPreset, HapticsResult } from 'rn-gamekit/haptics';

const haptics = createGameHaptics();
type _Presets = HapticPreset;
const _impact: _Presets = 'impact';
const _selection: _Presets = 'selection';
const _success: _Presets = 'success';
const _warning: _Presets = 'warning';
const _error: _Presets = 'error';
void _impact;
void _selection;
void _success;
void _warning;
void _error;

const result: HapticsResult = haptics.play('impact');
void result.played;
void result.reason;

haptics.play('selection');
haptics.play('success');

haptics.setMuted(true);
const _isMuted: boolean = haptics.isMuted();
void _isMuted;

const _supported: boolean = haptics.isSupported('impact');
void _supported;

haptics.dispose();

// Invalid preset must fail
// @ts-expect-error - unknown preset
haptics.play('unknownPreset');

// Ensure root does not eagerly load haptics backend
import * as Root from 'rn-gamekit';
void Root.createGameSession;

// @ts-expect-error - haptics not on root
void Root.createGameHaptics;

void haptics;
