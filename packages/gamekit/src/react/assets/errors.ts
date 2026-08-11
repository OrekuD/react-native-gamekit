/**
 * Asset store errors (T7.4).
 *
 * The store adds no error codes of its own: every failure is a structured
 * `GameAssetError` with a stable code and field path.
 */
export { GameAssetError } from '../../assets/errors';
