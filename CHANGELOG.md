# Change Log

All notable changes to this project will be documented in this file.

## [1.3.0] - 2026-10-05

### Added
- Added Node.js 24 and npm 11.12.1 requirements with build, typecheck, lint, and format-check scripts
- Added logger filter coverage for AND, OR, and IGNORE modes and production logging behavior

### Changed
- Production logging now writes warnings and errors to files only - Info messages are not logged and no console transport is created
- Updated TypeScript, ESLint, Prettier, Winston, and WebSocket dependencies
- Removed unused and vulnerable dependencies

### Fixed
- Fixed WebSocket server startup fallthrough and TypeScript type-only exports
- Cleaned generated build output before compilation and excluded runtime logs from npm packages

## [1.2.0] - 2022-05-12

### Added
- Default serializer and validator

## [1.1.0] - 2024-10-20

### Added
- Extensions

### Fixed
- Logger empty tags checking

## [1.0.2] - 2024-10-10

### Added
- File .npmignore

## [1.0.1] - 2024-10-10

### Changed
- Repo link

## [1.0.0] - 2024-10-10

### First release of Shardy