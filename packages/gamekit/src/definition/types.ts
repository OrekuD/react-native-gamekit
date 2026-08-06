/**
 * Core public types for the provisional GameKit definition contract.
 *
 * Everything in this module is provisional until reference games validate
 * the `defineGame` shape. Task 1 only establishes the contract; runtime
 * behavior arrives in later tasks.
 */

/**
 * The logical size of the game viewport in design points.
 *
 * This is the coordinate space the game is authored against. It is
 * independent of physical pixels and of the mounted surface size; the
 * viewport policy decides how it maps onto the actual game view.
 */
export interface LogicalSize {
  /** Logical width in points. Must be a positive number. */
  readonly width: number;
  /** Logical height in points. Must be a positive number. */
  readonly height: number;
}

/**
 * How the logical viewport is scaled to fit the mounted game surface.
 *
 * - `'fit'`: uniform scale that keeps the entire logical area visible;
 *   unused space is handled by the overflow policy.
 * - `'fill'`: uniform scale that fills the surface, cropping excess
 *   logical area.
 * - `'extend-world'`: keep the scale and reveal more world on larger or
 *   wider surfaces.
 *
 * The chosen policy affects both drawing and input hit-testing through the
 * same transform.
 */
export type ScalePolicy = 'fit' | 'fill' | 'extend-world';

/**
 * What happens to the surface area outside the logical viewport.
 *
 * - `'letterbox'`: show bars or unused space where aspect ratios differ.
 * - `'crop'`: clip the excess logical area.
 * - `'adaptive'`: let the scene select its layout from breakpoint or
 *   capability rules.
 */
export type OverflowPolicy = 'letterbox' | 'crop' | 'adaptive';

/**
 * The viewport configuration of a game definition.
 *
 * See the research document for the full viewport policy matrix
 * (`letterbox`/`fit`, `crop`/`fill`, `extend-world`, `adaptive`).
 */
export interface Viewport {
  /** The logical coordinate space the game is authored against. */
  readonly logicalSize: LogicalSize;
  /** How the logical viewport scales onto the mounted game surface. */
  readonly scale: ScalePolicy;
  /** How area outside the logical viewport is treated. */
  readonly overflow: OverflowPolicy;
}

/**
 * A source for a game asset (image, audio, font, ...).
 *
 * Strings represent remote or file URIs. Numbers represent static React
 * Native resources returned by `require('./asset.png')`.
 */
export type AssetSource = string | number;

/**
 * A reference to a game asset (image, audio, font, ...).
 *
 * Provisional: asset loading and lifecycle are implemented in a later task.
 */
export interface AssetDescriptor {
  /** Stable identifier used to reference the asset from game code. */
  readonly id: string;
  /** Remote/file URI or static React Native resource handle. */
  readonly source: AssetSource;
}

/**
 * A named input action a game can react to.
 *
 * Provisional: action mapping from platform input (gestures, keys,
 * virtual controls) is implemented in a later task.
 */
export interface InputAction {
  /** Optional human-readable description for diagnostics and tooling. */
  readonly description?: string;
}

/**
 * The collection of input actions a game declares.
 */
export type InputMap = Readonly<Record<string, InputAction>>;

/**
 * A scene registration in a game definition.
 *
 * Provisional: scene creation, lifecycle, and transitions are implemented
 * in a later task. The map key is the scene's stable identifier.
 */
export interface SceneDefinition {
  /** Optional human-readable name for diagnostics. Defaults to the map key. */
  readonly name?: string;
}

/**
 * The collection of scenes a game declares, keyed by scene name.
 */
export type SceneMap = Readonly<Record<string, SceneDefinition>>;

/**
 * A complete game definition produced by {@link defineGame}.
 *
 * `defineGame` validates the shape at the type level and preserves and
 * returns the supplied definition; it creates no runtime state.
 */
export interface GameDefinition<
  TScenes extends SceneMap = SceneMap,
  TInput extends InputMap = InputMap,
> {
  /** The viewport configuration of the game. */
  readonly viewport: Viewport;
  /** The assets the game can load. */
  readonly assets: readonly AssetDescriptor[];
  /** The input actions the game declares. */
  readonly input: TInput;
  /** The scenes of the game, keyed by scene name. */
  readonly scenes: TScenes;
  /** The scene to enter first. Must be one of the `scenes` keys. */
  readonly initialScene: keyof TScenes;
}
