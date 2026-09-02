import type { HapticPreset } from 'rn-gamekit/haptics';

export type MossyCavern3EventName =
  | 'jumped'
  | 'landed'
  | 'dashed'
  | 'crystal-collected'
  | 'checkpoint-activated'
  | 'player-hurt'
  | 'level-completed';

export type MossyCavern3Sound =
  | 'ui'
  | 'dash'
  | 'crystal'
  | 'checkpoint'
  | 'hurt'
  | 'complete';

export interface MossyCavern3FeedbackCue {
  readonly sound: MossyCavern3Sound | null;
  readonly haptic?: HapticPreset;
  readonly save: boolean;
}

export function feedbackForMossyCavern3Event(
  name: MossyCavern3EventName,
): MossyCavern3FeedbackCue {
  switch (name) {
    case 'jumped':
      return { haptic: 'light', save: false, sound: null };
    case 'landed':
      return { save: false, sound: null };
    case 'dashed':
      return { haptic: 'medium', save: false, sound: 'dash' };
    case 'crystal-collected':
      return { haptic: 'selection', save: true, sound: 'crystal' };
    case 'checkpoint-activated':
      return { haptic: 'success', save: true, sound: 'checkpoint' };
    case 'player-hurt':
      return { haptic: 'heavy', save: true, sound: 'hurt' };
    case 'level-completed':
      return { haptic: 'success', save: true, sound: 'complete' };
  }
}
