export interface StageSize {
  readonly width: number;
  readonly height: number;
}

const ZERO_STAGE = Object.freeze({ width: 0, height: 0 });

function isUsableSize(size: StageSize): boolean {
  return (
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

/**
 * Return the largest exact-aspect game stage contained by a measured slot.
 *
 * Keeping the React Native stage at the authored logical aspect means Skia's
 * fitted content, the visible HUD, and the pointer surface occupy the same
 * rectangle. The helper is intentionally platform-neutral so phone, tablet,
 * rotation, Split View, and Stage Manager layouts share one rule.
 */
export function fitGameStage(available: StageSize, logical: StageSize): StageSize {
  if (!isUsableSize(logical)) {
    throw new RangeError(
      `Game stage logical size must be finite and positive (got ${logical.width} x ${logical.height})`,
    );
  }
  if (!isUsableSize(available)) {
    return ZERO_STAGE;
  }

  const widthLimitedHeight = available.width * (logical.height / logical.width);
  if (widthLimitedHeight <= available.height) {
    return Object.freeze({ width: available.width, height: widthLimitedHeight });
  }

  return Object.freeze({
    width: available.height * (logical.width / logical.height),
    height: available.height,
  });
}
