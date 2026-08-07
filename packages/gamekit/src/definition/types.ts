/** The logical size of the game viewport in design points. */
export interface LogicalSize {
  /** Logical width in points. */
  readonly width: number;
  /** Logical height in points. */
  readonly height: number;
}

/** How the logical viewport scales onto the mounted surface. */
export type ScalePolicy = 'fit' | 'fill' | 'extend-world';

/** How area outside the logical viewport is treated. */
export type OverflowPolicy = 'letterbox' | 'crop' | 'adaptive';

/** The authored viewport policy for a game. */
export interface Viewport {
  /** The logical coordinate space the game is authored against. */
  readonly logicalSize: LogicalSize;
  /** How the logical viewport scales onto the mounted game surface. */
  readonly scale: ScalePolicy;
  /** How area outside the logical viewport is treated. */
  readonly overflow: OverflowPolicy;
}

/** A URI or static React Native resource handle. */
export type AssetSource = string | number;

/** A stable game asset declaration. Loading arrives in a later task. */
export interface AssetDescriptor {
  /** Stable identifier used by game code. */
  readonly id: string;
  /** Remote/file URI or static React Native resource handle. */
  readonly source: AssetSource;
}

/** The button action supported by the first runtime slice. */
export interface ButtonInputAction {
  /** Discriminant for a digital button action. */
  readonly type: 'button';
  /** Optional human-readable description for diagnostics and tooling. */
  readonly description?: string;
}

/** A named input action. More action kinds will be added deliberately. */
export type InputAction = ButtonInputAction;

/** The collection of semantic input actions declared by a game. */
export type InputMap = Readonly<Record<string, InputAction>>;

/**
 * Structural marker shared by all definitions created with `defineScene`.
 *
 * It lets `defineGame` retain each scene's inferred state and snapshot types
 * without erasing them into a universal world or renderer shape.
 */
export interface SceneDefinitionMarker {
  /** Internal scene-definition discriminator. */
  readonly kind: 'gamekit.scene';
  /** @internal Type witness for actions consumed by this scene. */
  readonly __actionType?: string;
}

/** The collection of functional scenes declared by a game. */
export type SceneMap = Readonly<Record<string, SceneDefinitionMarker>>;

/**
 * A complete static game definition produced by `defineGame`.
 *
 * Creating a definition allocates no runtime state. Pass it to
 * `createGameSession` when a live headless session is required.
 */
export interface GameDefinition<
  TScenes extends SceneMap = SceneMap,
  TInput extends InputMap = InputMap,
  TInitialScene extends keyof TScenes = keyof TScenes,
> {
  /** The viewport configuration of the game. */
  readonly viewport: Viewport;
  /** Assets declared by the game. Loading is not implemented yet. */
  readonly assets: readonly AssetDescriptor[];
  /** Semantic input actions declared by the game. */
  readonly input: TInput;
  /** Functional scenes keyed by stable scene name. */
  readonly scenes: TScenes;
  /** The scene created by the first runtime slice. */
  readonly initialScene: TInitialScene;
}
