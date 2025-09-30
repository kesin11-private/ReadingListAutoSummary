# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ReadingListAutoSummary AI Coding Guide

## Project Overview
This is a Chrome extension (Manifest V3) that automatically manages Chrome's Reading List by marking old entries as read and generating AI-powered summaries before archiving. The extension uses `chrome.readingList` API for Reading List integration and posts summaries to Slack.

## Core Architecture

### Entry Points & Build System
- **Background Script**: `src/backend/background.ts` - Main service worker (currently empty, needs implementation)
- **Options Page**: `src/frontend/options/options.html` - Settings UI (implemented with Preact; entry: `src/frontend/options/options.tsx`)
- **Build System**: Custom Vite config with specialized Chrome extension bundling

The build process uses a unique dual-bundling approach:
1. Main Vite build for frontend components
2. Secondary `generateStandaloneBundle()` for background script (ES modules format)

### Essential Development Commands
```bash
pnpm dev              # Development build with watch mode
pnpm build            # Production build
pnpm build:release    # Production build + zip for Chrome Web Store
pnpm test             # Run all tests (--silent flag)
pnpm test:ci          # Run tests with coverage reporting
pnpm type-check       # TypeScript type checking (tsc --noEmit)
pnpm biome            # Check code formatting and linting
pnpm biome:fix        # Auto-fix code formatting and linting issues
pnpm check:ai         # Complete validation pipeline (type-check + lint + test + build)
```

**Important**: Always use `pnpm check:ai` before commits - it runs the full validation pipeline that AI tools need.

## Critical Implementation Details

### Chrome Extension Specifics
- **Permissions**: `["storage", "readingList", "alarms"]` in `manifest.json`
- **Host Permissions**: `["https://hooks.slack.com/*"]` for Slack webhook integration
- **Storage**: Uses `chrome.storage.local` for settings persistence
- **Background**: Service worker (`src/backend/background.ts`) runs periodically via `chrome.alarms` API
- **Dependencies**: Runtime deps include `openai` and `preact`. Build uses TypeScript, Vite, Biome, and Vitest

### Data Flow Pattern
1. Background script queries `chrome.readingList` API
2. Check entry ages against user-configured thresholds (default: 30 days → read, 60 days → delete)
3. On marking as read: Extract content → Summarize with OpenAI-compatible API → Post to Slack
4. Retry logic: Exponential backoff (3 attempts max) for external API failures

### Slack Integration Format
```
{title}
{url}

{model_name}による要約

{本文section1}

{本文section2}

{本文section3}
```

## Development Patterns

### Frontend UI: Preact
- The options page is implemented with Preact
  - Entry: `src/frontend/options/options.tsx` (mounted to `#root`)
  - Loaded from HTML: add `<script type="module" src="/src/frontend/options/options.tsx"></script>` to `src/frontend/options/options.html`
- Vite configuration
  - Add `@preact/preset-vite` to `plugins` in `vite.config.ts`
  - With strict typing, if types mismatch, cast `preact()` to `PluginOption` to work around
- TypeScript configuration
  - Set `"jsx": "react-jsx"` and `"jsxImportSource": "preact"` in `tsconfig.json`
- Tests
  - Runs in the existing jsdom environment (no extra setup required)

### Testing Configuration
- **Test Framework**: Vitest with jsdom environment
- **Structure**: 
  - Frontend tests: `tests/frontend/**/*.test.ts`
  - Backend tests: `tests/backend/**/*.test.ts`
  - Common utilities: `tests/common/**/*.test.ts`
- **Key Settings**: 
  - Watch mode disabled (`watch: false`) for AI compatibility
  - Silent mode enabled for cleaner output
  - Coverage available via `test:ci`
- **Console Methods**: Do not mock `console.log`, `console.error` etc. in tests

### Code Quality Tools
- **Biome**: Comprehensive linting/formatting with strict rules
  - No explicit `any` types
  - Unused imports/variables as errors
  - Double quotes for strings
- **TypeScript**: Strict mode with `noEmit` for type checking

### AI-Specific Considerations
- Use `pnpm check:ai` before commits (validates everything)
- All external API integrations need retry logic with exponential backoff
- **Commit messages must be in English** - Always write commit messages in English for consistency
- Settings stored in `chrome.storage.local` with these keys:
  - Days until read (default: 30)
  - Days until delete (default: 60)
  - OpenAI API endpoint/key/model
  - Slack webhook URL

### Type Safety Best Practices
- **Use Discriminated Unions for State and Configuration**
  - Example: `ExtractContentConfig` uses discriminated union with `provider` field to ensure type-safe provider-specific configurations
  - Example: `ExtractContentResult` uses discriminated union with `success` boolean to ensure only valid field combinations exist
  - Benefits: Eliminates impossible states (e.g., `success: true` with `error` field), enables exhaustive pattern matching, provides better IDE autocomplete
- **Avoid Optional Fields for Required Data**
  - Instead of `{ apiKey?: string, baseUrl?: string }`, use strict types like `{ apiKey: string, baseUrl: string }`
  - Push validation to the boundary (e.g., settings UI or API call site) rather than allowing undefined/null to propagate
- **Eliminate Error-Prone Fallback Logic**
  - Avoid silent fallbacks like `baseUrl || DEFAULT_BASE_URL` in deep call chains
  - Fail fast with explicit errors at configuration time rather than masking issues during runtime
  - Example: Removed URL parsing fallback in `extractWithFirecrawl` - invalid URLs now throw immediately

## File Patterns
- Backend code: `src/backend/` (Service worker)
- Frontend code: `src/frontend/` (Options page; Preact entry at `src/frontend/options/options.tsx`)
- Tests mirror source structure: `tests/{backend|frontend}/`
- Build output: `dist/` with specialized structure for Chrome extension

## Package Management
- **Use pnpm**: Always use `pnpm` for package management, not npm or yarn
- Install packages with `pnpm add <package>`
- Install dev dependencies with `pnpm add -D <package>`

## Key Source Files
- **Background Script**: `src/backend/background.ts` - Main service worker entry point
- **Content Extraction**: `src/backend/content_extractor.ts` - Web content extraction logic
- **Summarization**: `src/backend/summarizer.ts` - OpenAI API integration for summarization
- **Slack Integration**: `src/backend/post.ts` - Slack webhook posting
- **Storage Layer**: `src/common/chrome_storage.ts` - Chrome storage API wrapper
- **Options UI**: `src/frontend/options/options.tsx` - Settings page (Preact component)
- **Type Definitions**: `src/types/messages.ts` - Shared type definitions

## Architecture Notes

### Build System Specifics
- **Dual bundling**: Vite handles main build, custom `generateStandaloneBundle()` handles background script
- **Background script**: Built as ES modules (`format: "es"`) for service worker compatibility
- **Output structure**: Carefully designed for Chrome extension - avoid modifying build config
- **File copying**: `manifest.json` and other assets copied via custom Vite plugin

### Chrome Extension Context
- **Service Worker**: Background script runs in service worker context with full Chrome API access
- **Options Page**: Runs in regular web page context - no direct Chrome API access (must use messages)
- **Permissions**: Limited to `["storage", "readingList", "alarms"]` - stick to declared permissions
- **Storage**: All settings persisted via `chrome.storage.local` with structured keys

### Development Workflow
- **Hot reload**: `pnpm dev` provides watch mode for frontend development
- **Testing**: Separate test environments for frontend (jsdom) and backend (node)
- **Validation**: `pnpm check:ai` runs complete pipeline before commits
- **Extensions**: Load `dist/` folder as unpacked extension for testing
