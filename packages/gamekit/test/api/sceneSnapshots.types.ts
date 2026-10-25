/** Compile-only public snapshot contracts: tuple shape, metadata, and errors. */
import {
  SnapshotDomainError,
  type DeepReadonly,
  type GameRenderFrame,
  defineGame,
  defineScene,
} from 'rn-gamekit';

const scene = defineScene({
  actions: [],
  create: () => ({ x: 1, label: 'player' }),
  update: ({ state }) => state,
  snapshot: ({ state }) => [state.x, { label: state.label }] as const,
});
const _game = defineGame({
  viewport: { logicalSize: { width: 320, height: 180 }, mode: 'fit' },
  input: {},
  scenes: { play: scene },
  initialScene: 'play',
});
declare const frame: GameRenderFrame<typeof _game.scenes>;
const x: number = frame.current[0];
const label: string = frame.current[1].label;
const tupleLength: 2 = frame.current.length;
const pair: readonly [number, { readonly label: string }] = frame.current;
// @ts-expect-error Published tuple positions cannot be assigned.
frame.current[0] = 2;
// @ts-expect-error Published tuple children are deeply readonly.
frame.current[1].label = 'enemy';

declare const optional: DeepReadonly<[number, { label: string }?]>;
const optionalLabel: string | undefined = optional[1]?.label;
const optionalLength: 1 | 2 = optional.length;
const optionalPair: readonly [number, { readonly label: string }?] = optional;
declare const variadic: DeepReadonly<[number, ...{ label: string }[]]>;
const first: number = variadic[0];
const later: { readonly label: string } | undefined = variadic[1];
const [head, ...tail] = variadic;
const restHead: number = head;
const restTail: readonly { readonly label: string }[] = tail;

type Items = { x: number }[] & { meta: { source: string } };
declare const items: DeepReadonly<Items>;
const source: string = items.meta.source;
// @ts-expect-error Published array metadata is deeply readonly.
items.meta.source = 'changed';
// @ts-expect-error Published arrays cannot be appended to.
items.push({ x: 2 });
// @ts-expect-error Published array elements cannot be changed.
items[0]!.x = 2;
items.map((item) => {
  // @ts-expect-error Array iteration receives deeply readonly elements.
  item.x = 2;
  return item.x;
});
declare const readonlyItems: DeepReadonly<readonly { x: number }[] & { meta: { source: string } }>;
readonlyItems.map((item) => {
  // @ts-expect-error Readonly tagged arrays also expose deeply readonly elements.
  item.x = 2;
  return item.x;
});

declare const error: unknown;
if (error instanceof SnapshotDomainError) {
  const path: string = error.path;
  const sceneName: string | undefined = error.scene;
  void [path, sceneName];
}

void [x, label, tupleLength, pair, optionalLabel, optionalLength, optionalPair, first, later, restHead, restTail, source];
