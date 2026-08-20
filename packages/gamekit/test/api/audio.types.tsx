import { createGameAudio } from 'rn-gamekit/audio';
import type { GameAudio, AudioCategory } from 'rn-gamekit/audio';

// Creation preserves literal sound IDs
const audioPromise = createGameAudio({
  sounds: {
    brickHit: 1 as unknown as number,
    levelMusic: 2 as unknown as number,
  },
});
type BrickHitAudio = Awaited<typeof audioPromise>;
type _SoundKeys = BrickHitAudio extends GameAudio<infer T> ? keyof T : never;
const _checkSoundKeys: 'brickHit' | 'levelMusic' = 'brickHit' as _SoundKeys & string;
void _checkSoundKeys;

// Ensure the resolved audio has the expected methods
declare const audio: BrickHitAudio;
audio.play('brickHit');
audio.play('brickHit', { category: 'sfx', volume: 0.8, loop: true });
audio.play('brickHit', { category: 'master' });
void audio.playMusic('levelMusic');
audio.stopMusic();
audio.pause();
audio.resume();
audio.setVolume('sfx', 0.8);
audio.setVolume('master', 1);
const _vol: number = audio.getVolume('music');
void _vol;
audio.setMuted(false);
const _muted: boolean = audio.isMuted();
void _muted;
audio.dispose();

// Volume category is fixed union
type _Cat = AudioCategory;
const _catMaster: _Cat = 'master';
const _catMusic: _Cat = 'music';
const _catSfx: _Cat = 'sfx';
const _catUi: _Cat = 'ui';
void _catMaster;
void _catMusic;
void _catSfx;
void _catUi;

// Category typo must fail
// @ts-expect-error - invalid category
audio.setVolume('invalidCategory', 0.5);

// Unknown sound ID must fail
// @ts-expect-error - unknown sound
audio.play('unknownSound');

// Ensure root does not eagerly load audio backend
import * as Root from 'rn-gamekit';
void Root.createGameSession;

// Ensure audio subpath does not pollute root
// @ts-expect-error - audio not on root
void Root.createGameAudio;

void audioPromise;
