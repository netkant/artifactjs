# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Error recovery and status inspection API**: Added new functions for checking artifact status and handling errors without Suspense or Error Boundaries
  - `getArtifactStatus(ref)`: Returns `'pending' | 'resolved' | 'rejected'` for inspecting artifact status outside React (triggers hydration as a side effect)
  - `useArtifactLoadable(ref)`: Returns `{ status, value, error }` without suspending or throwing, enabling custom loading/error UIs
  - `ArtifactLoadable<T>` type: Discriminated union type representing all possible artifact states
  - During revalidation, loadable status becomes `'pending'` with `value: undefined` (no stale-while-revalidate behavior)
- **Parameterized cache options**: Added optional `key` and `maxEntries` configuration for parameterized artifacts
  - `key`: Custom function to generate cache keys for parameterized instances (default: deterministic JSON.stringify with sorted object keys)
  - `maxEntries`: Soft LRU cap on parameterized instances with automatic eviction of unsubscribed, non-pending instances (default: Infinity / unlimited)
  - Improved default key generation to properly handle Date, RegExp, Map, and Set objects
  - `useSetArtifact` and `useResetArtifact` now pin instances to prevent LRU eviction while hooks are mounted

### Changed

- **Documentation**: Expanded README guidance on `maxEntries` for parameterized artifacts to clarify when and why developers should set finite limits (recommended: 200–500 for dynamic ID / infinite-scroll use cases), while emphasizing that the unlimited default (Infinity) remains unchanged for backward compatibility
- **Performance**: Optimized default cache key generation with tiered fast paths:
  - Single primitives (string/number/boolean/null/undefined/bigint): 73% faster via tagged keys (`p:n:1`, `p:s:"hello"`)
  - Flat objects (one level, primitives only): 17% faster via sorted keys with type-tagged values (`f:"id":n:1`)
  - Nested/exotic types (Date/Map/Set/array/nested objects): unchanged fallback to `stableStringify`
  - Overall speedup: ~19% for realistic mixed params
  - Cache key format intentionally changed (session-only; no persistence implications)
- **Performance**: Fixed O(n²) LRU tracking overhead on cold parameterized family creation
  - LRU tracking now skipped when `maxEntries` is `Infinity` (the default)
  - Cold path (100k unique instances): **258x faster** (41s → 158ms)
  - Families with default unlimited cache now create instances at O(n) instead of O(n²)
  - Finite `maxEntries` LRU tracking unaffected and works as before
  
### Fixed

- Cache key generation now properly distinguishes Date, RegExp, Map, and Set parameters instead of treating them as empty objects
- LRU eviction now skips pending async instances in addition to subscribed instances
- Invalid `maxEntries` values (<= 0, NaN) are now treated as `Infinity` (unlimited)
- Custom `key` function now throws an error when params are not a plain object (prevents silent fallback bugs)
