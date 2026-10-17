'use strict';

const assert = require('assert');
const {
  containsSensitiveRegex,
  detectCategory,
  detectGenericHash,
  looksLikeSecretToken,
  nerIndicatesPii,
  MIN_INPUT_LENGTH,
  evaluateRegex,
  evaluateNer,
  mergeSettings,
  actionForCategory,
  hasDisclosureContext
} = require('./detection-core.js');
const { getAdapter, isSendKey, isLlmHost, isLlmContext } = require('./site-adapters.js');

assert.strictEqual(MIN_INPUT_LENGTH, 6);
assert.strictEqual(containsSensitiveRegex('hello world'), false);
assert.strictEqual(containsSensitiveRegex('test@example.com'), true);
assert.strictEqual(containsSensitiveRegex('AKIA1234567890ABCDEF'), true);
assert.strictEqual(detectCategory('AKIA1234567890ABCDEF'), 'AWS Key');
assert.strictEqual(detectCategory('test@example.com'), 'Email');

// ── Generic hash/token false-positive reduction ──────────────────────────────
// Git SHA-1 (40 hex, lowercase) must NOT trip the generic hash rule on its own.
assert.strictEqual(detectGenericHash('commit 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b'), false);
// MD5 (32 hex) and SHA-256 (64 hex) checksums alone are not secrets.
assert.strictEqual(detectGenericHash('d41d8cd98f00b204e9800998ecf8427e'), false);
assert.strictEqual(detectGenericHash('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'), false);
// A lowercase-only opaque token with no secret cue should be ignored.
assert.strictEqual(detectGenericHash('abcdefabcdefabcdefabcdefabcdefab'), false);
// But a secret keyword nearby flips a bare hex token into a real detection.
assert.strictEqual(detectGenericHash('api_key d41d8cd98f00b204e9800998ecf8427e'), true);
assert.strictEqual(detectGenericHash('session token: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b'), true);
// High-entropy mixed-case+digit token looks like a real credential.
assert.strictEqual(detectGenericHash('xR7mK9pL2qN4sT6vW8yA1bC3dE5fG7hJ'), true);
// detectCategory should label a keyworded opaque token as Hash / Token.
assert.strictEqual(detectCategory('secret: xR7mK9pL2qN4sT6vW8yA1bC3dE5fG7hJ'), 'Hash / Token');
// looksLikeSecretToken direct checks.
assert.strictEqual(looksLikeSecretToken('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b'), false);
assert.strictEqual(looksLikeSecretToken('xR7mK9pL2qN4sT6vW8yA1bC3dE5fG7hJ'), true);
assert.strictEqual(looksLikeSecretToken('d41d8cd98f00b204e9800998ecf8427e', 'my api_key is here'), true);

assert.strictEqual(nerIndicatesPii([{ entity_group: 'LABEL_3', score: 0.91 }]), true);
assert.strictEqual(nerIndicatesPii([{ entity: 'LABEL_0', score: 0.99 }]), false);
assert.strictEqual(nerIndicatesPii([{ entity_group: 'LABEL_0', score: 0.99 }]), false);
assert.strictEqual(nerIndicatesPii([{ entity: 'LABEL_4', score: 0.4 }]), false);
assert.strictEqual(nerIndicatesPii([{ entity: 'B-PER', score: 0.82 }]), true);
assert.strictEqual(nerIndicatesPii([{ entity: 'O', score: 0.99 }]), false);
assert.strictEqual(nerIndicatesPii([{ entity: 'I-LOC', score: 0.7 }]), false);
assert.strictEqual(nerIndicatesPii([]), false);

const defaults = mergeSettings(null);
assert.strictEqual(defaults.scope, 'llm');
assert.strictEqual(defaults.categoryActions.secrets, 'block');
assert.strictEqual(defaults.categoryActions.contact, 'warn');
assert.strictEqual(defaults.categoryActions.ner, 'warn');

assert.strictEqual(evaluateRegex('AKIA1234567890ABCDEF', defaults).action, 'block');
assert.strictEqual(evaluateRegex('test@example.com', defaults).action, 'warn');
assert.strictEqual(evaluateRegex('I work at Google in London', defaults).action, 'clean');

const warnMode = mergeSettings({ mode: 'warn' });
assert.strictEqual(evaluateRegex('AKIA1234567890ABCDEF', warnMode).action, 'warn');

assert.strictEqual(actionForCategory('Email', defaults), 'warn');
assert.strictEqual(actionForCategory('AWS Key', defaults), 'block');

const london = [{ entity_group: 'LABEL_7', score: 0.92 }];
assert.strictEqual(hasDisclosureContext('I work at Google in London', 'PER'), false);
assert.strictEqual(hasDisclosureContext('My name is Ada Lovelace', 'PER'), true);
assert.strictEqual(evaluateNer('I work at Google in London', london, defaults).action, 'clean');

const nameHit = [{ entity_group: 'LABEL_3', score: 0.91 }];
const named = evaluateNer('My name is Ada Lovelace', nameHit, defaults);
assert.strictEqual(named.action, 'warn');
assert.strictEqual(named.category, 'Person');

const ignoreNer = mergeSettings({ categoryActions: { ner: 'ignore' } });
assert.strictEqual(evaluateNer('My name is Ada Lovelace', nameHit, ignoreNer).action, 'clean');

assert.strictEqual(getAdapter('chatgpt.com').id, 'chatgpt');
assert.strictEqual(getAdapter('chat.openai.com').id, 'chatgpt');
assert.strictEqual(getAdapter('claude.ai').id, 'claude');
assert.strictEqual(getAdapter('example.com'), null);
assert.strictEqual(getAdapter('www.chatgpt.com').id, 'chatgpt');
assert.strictEqual(isLlmHost('gemini.google.com'), true);
assert.strictEqual(isLlmHost('news.ycombinator.com'), false);
assert.strictEqual(Boolean(isLlmContext('chatgpt.com')), true);

assert.strictEqual(isSendKey({ key: 'Enter', shiftKey: false, isComposing: false }), true);
assert.strictEqual(isSendKey({ key: 'Enter', shiftKey: true, isComposing: false }), false);
assert.strictEqual(isSendKey({ key: 'Enter', shiftKey: false, isComposing: true }), false);

console.log('detection-core + site-adapter unit checks passed.');
