'use strict';

const assert = require('assert');
const {
  containsSensitiveRegex,
  detectCategory,
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
