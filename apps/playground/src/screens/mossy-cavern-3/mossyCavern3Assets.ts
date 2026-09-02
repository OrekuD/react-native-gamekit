import { defineAssets, image, spriteSheet } from 'rn-gamekit/assets';

export const mossyCavern3Assets = defineAssets({
  world: {
    platforms: spriteSheet(
      require('../../../assets/mossy-cavern-3/art/floating-platforms.png'),
      {
        animations: {},
        frames: {
          column: { x: 1590, y: 40, width: 450, height: 900 },
          island: { x: 70, y: 40, width: 340, height: 340 },
          ledge: { x: 470, y: 30, width: 1050, height: 460 },
          ridge: { x: 430, y: 1080, width: 1580, height: 450 },
        },
      },
    ),
    poisonPlant: image(require('../../../assets/mossy-cavern-3/art/poison-plant.png')),
    slimeGreenA: image(require('../../../assets/mossy-cavern-3/art/slime-green-a.png')),
    slimeGreenB: image(require('../../../assets/mossy-cavern-3/art/slime-green-b.png')),
    slimeOrange: image(require('../../../assets/mossy-cavern-3/art/slime-orange.png')),
    wizardDash: image(require('../../../assets/mossy-cavern-3/art/wizard-dash.png')),
    wizardIdleA: image(require('../../../assets/mossy-cavern-3/art/wizard-idle-a.png')),
    wizardIdleB: image(require('../../../assets/mossy-cavern-3/art/wizard-idle-b.png')),
    wizardJump: image(require('../../../assets/mossy-cavern-3/art/wizard-jump.png')),
    wizardWalkA: image(require('../../../assets/mossy-cavern-3/art/wizard-walk-a.png')),
    wizardWalkB: image(require('../../../assets/mossy-cavern-3/art/wizard-walk-b.png')),
    keyboardPrompts: spriteSheet(
      require('../../../assets/mossy-cavern-3/prompts/keyboard.png'),
      {
        animations: {},
        frames: {
          space: { x: 98, y: 94, width: 105, height: 17 },
          wasd: { x: 57, y: 61, width: 70, height: 40 },
        },
      },
    ),
    xboxPrompts: spriteSheet(
      require('../../../assets/mossy-cavern-3/prompts/xbox.png'),
      {
        animations: {},
        frames: {
          actionA: { x: 207, y: 45, width: 28, height: 30 },
          dpad: { x: 105, y: 48, width: 42, height: 42 },
        },
      },
    ),
  },
});
