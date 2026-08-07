/**
 * Props the playground shell supplies to every mounted game screen.
 *
 * Game screens are ordinary components: they receive only an exit callback and
 * never import the shell store directly. This keeps example games portable and
 * makes their exit behavior easy to test.
 */
export interface PlaygroundGameScreenProps {
  /** Close the game and return to the catalog. */
  readonly onExit: () => void;
}
