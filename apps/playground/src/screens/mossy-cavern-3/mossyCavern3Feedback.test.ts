import assert from 'node:assert/strict';
import test from 'node:test';

import { feedbackForMossyCavern3Event } from './mossyCavern3Feedback.ts';

test('maps committed gameplay facts to bounded device feedback', () => {
  assert.deepEqual(feedbackForMossyCavern3Event('jumped'), {
    haptic: 'light',
    save: false,
    sound: null,
  });
  assert.deepEqual(feedbackForMossyCavern3Event('crystal-collected'), {
    haptic: 'selection',
    save: true,
    sound: 'crystal',
  });
  assert.deepEqual(feedbackForMossyCavern3Event('checkpoint-activated'), {
    haptic: 'success',
    save: true,
    sound: 'checkpoint',
  });
  assert.deepEqual(feedbackForMossyCavern3Event('player-hurt'), {
    haptic: 'heavy',
    save: true,
    sound: 'hurt',
  });
  assert.deepEqual(feedbackForMossyCavern3Event('level-completed'), {
    haptic: 'success',
    save: true,
    sound: 'complete',
  });
});

test('landing avoids audio and haptic spam', () => {
  assert.deepEqual(feedbackForMossyCavern3Event('landed'), {
    save: false,
    sound: null,
  });
});
