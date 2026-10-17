'use strict';

// Flat ESLint config. The project mixes three runtimes:
//  - browser content/page scripts (window, document, chrome)
//  - the MV3 service worker (self, importScripts, chrome)
//  - Node test scripts (require, module, process)
// Each gets the right globals so no-undef stays useful instead of noisy.

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  chrome: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  CustomEvent: 'readonly',
  KeyboardEvent: 'readonly',
  MutationObserver: 'readonly',
  Node: 'readonly',
  ShadowRoot: 'readonly',
  Element: 'readonly',
  Text: 'readonly',
  Blob: 'readonly',
  URL: 'readonly',
  Cache: 'readonly',
  Promise: 'readonly',
  getComputedStyle: 'readonly',
  location: 'readonly',
  devicePixelRatio: 'readonly',
  alert: 'readonly',
  confirm: 'readonly'
};

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  process: 'readonly',
  __dirname: 'readonly',
  console: 'readonly',
  globalThis: 'readonly'
};

const workerGlobals = {
  self: 'readonly',
  importScripts: 'readonly',
  chrome: 'readonly',
  console: 'readonly'
};

const sharedRules = {
  'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-undef': 'error',
  'no-var': 'error',
  'prefer-const': 'warn',
  eqeqeq: ['warn', 'smart'],
  'no-console': 'off'
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'libs/transformers.min.js',
      'wasm/**',
      'web_model/**'
    ]
  },
  {
    // Browser-only extension scripts
    files: ['content.js', 'popup.js', 'dashboard.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...browserGlobals, globalThis: 'readonly' }
    },
    rules: sharedRules
  },
  {
    // UMD modules that load in both the browser and Node (tests)
    files: ['detection-core.js', 'site-adapters.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...browserGlobals, ...nodeGlobals, globalThis: 'readonly' }
    },
    rules: sharedRules
  },
  {
    // Page-injected ES module
    files: ['libs/page-injected-module.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals
    },
    rules: sharedRules
  },
  {
    // MV3 service worker
    files: ['background.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: workerGlobals
    },
    rules: sharedRules
  },
  {
    // Node test scripts
    files: ['test_*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: nodeGlobals
    },
    rules: sharedRules
  }
];
