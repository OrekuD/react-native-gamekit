#!/usr/bin/env node
/**
 * Minimal Expo-prebuild spike for Task 14 — device-gated.
 *
 * Intended to be run inside a dev-client build on physical iOS/Android
 * hardware. Simulators cannot prove audio routes, silent-mode, or haptic
 * actuator behavior.
 *
 * 1. One SFX
 * 2. One music track (replace semantics)
 * 3. Pause / resume (game session + AppState)
 * 4. One interruption listener (AudioContext state + AppState)
 * 5. One Pulsar preset
 *
 * Usage (requires dev-client):
 *   pnpm --filter rn-gamekit exec node --import tsx scripts/spike-audio-haptics.mjs
 *   # or inside playground:
 *   npx expo run:ios   # then trigger from a screen
 *
 * This placeholder passes in CI (no hardware) and is honestly device-gated.
 */

console.log('[spike] audio/haptics — device-gated placeholder');
console.log('[spike] Steps that must be validated on hardware:');
console.log('  - createGameAudio({ sounds: { sfx: require, music: require } })');
console.log('  - audio.play("sfx") -> audible once, fire-and-forget');
console.log('  - audio.playMusic("music") -> one channel, replace semantics');
console.log('  - audio.pause() / audio.resume() with GameSession status + AppState');
console.log('  - AudioContext.suspend/resume/close + interruption recovery');
console.log('  - haptics.play("impact") -> HapticsResult { played: boolean }');
console.log('[spike] No hardware attached — spike is device-gated (honestly open).');
