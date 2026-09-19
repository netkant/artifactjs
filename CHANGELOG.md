# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Parameterized cache options**: Added optional `key` and `maxEntries` configuration for parameterized artifacts
  - `key`: Custom function to generate cache keys for parameterized instances (default: deterministic JSON.stringify with sorted object keys)
  - `maxEntries`: Soft LRU cap on parameterized instances with automatic eviction of unsubscribed instances
  - Improved default key generation to properly handle Date, RegExp, Map, and Set objects
  
### Changed

- **BEHAVIOR CHANGE**: Parameterized artifact factories now default to `maxEntries: 500` (previously unlimited)
  - This change reduces memory footprint for applications with many parameterized instances
  - Only unsubscribed and non-pending instances are evicted when the limit is reached
  - Static/promise artifacts remain unaffected (still unlimited by default)
  - To restore unlimited caching, set `maxEntries: Infinity` or `maxEntries: false`
  
### Fixed

- Cache key generation now properly distinguishes Date, RegExp, Map, and Set parameters instead of treating them as empty objects
- LRU eviction now skips pending async instances in addition to subscribed instances
- Invalid `maxEntries` values (<= 0, NaN) are now treated as `Infinity` (unlimited)
