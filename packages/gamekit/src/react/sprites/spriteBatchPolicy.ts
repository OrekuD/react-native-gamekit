/** Pure SpriteBatch update policy (RF8): the overflow decision and the
 * active count. Development reports a structured error; production clamps
 * and hides the overflow so the UI runtime never crashes for ordinary data
 * growth. Runs inside the batch's update worklet, so it carries the worklet
 * directive. */
export function batchUpdatePolicy(
  itemsCount: number,
  capacity: number,
  dev: boolean,
): { readonly overflow: boolean; readonly activeCount: number } {
  'worklet';
  if (itemsCount <= capacity) {
    return { overflow: false, activeCount: itemsCount };
  }
  if (dev) {
    throw new Error(
      `SpriteBatch overflow: ${itemsCount} items selected with capacity ${capacity}`,
    );
  }
  return { overflow: true, activeCount: capacity };
}
