'use strict';

const assert = require('assert');
const {
  containsSensitiveRegex,
  detectCategory,
  detectGenericHash,
  detectCreditCard,
  validateLuhn,
  looksLikeSecretToken,
  nerIndicatesPii,
  MIN_INPUT_LENGTH,
  evaluateRegex,
  evaluateNer,
  mergeSettings,
  normalizeCustomRules,
  actionForCategory,
  hasDisclosureContext,
  redactText,
  matchingCategories,
  maskSecret,
  maskedPreview
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

// ── Luhn credit-card validation ──────────────────────────────────────────────
// A valid Visa test number passes Luhn; an invalid 16-digit run does not.
assert.strictEqual(validateLuhn('4111111111111111'), true);
assert.strictEqual(validateLuhn('4111 1111 1111 1111'), true);
assert.strictEqual(validateLuhn('1234567890123456'), false);
// Amex (15 digits) and Mastercard test numbers pass.
assert.strictEqual(validateLuhn('378282246310005'), true);
assert.strictEqual(validateLuhn('5555555555554444'), true);
// Too short / too long fail the length gate.
assert.strictEqual(validateLuhn('411111111111'), false);
// detectCreditCard only fires on Luhn-valid sequences.
assert.strictEqual(detectCreditCard('card 4111 1111 1111 1111'), true);
assert.strictEqual(detectCreditCard('order 1234567890123456'), false);
assert.strictEqual(detectCategory('my card is 4111 1111 1111 1111'), 'Credit Card');

// ── Provider-specific secret formats ─────────────────────────────────────────
assert.strictEqual(containsSensitiveRegex('ghp_' + 'a'.repeat(36)), true);
assert.strictEqual(detectCategory('token ghp_' + 'a'.repeat(36)), 'GitHub Token');
assert.strictEqual(detectCategory('xoxb-123456789012-abcdefABCDEF'), 'Slack Token');
assert.strictEqual(detectCategory('sk_live_' + 'a'.repeat(24)), 'Stripe Key');
assert.strictEqual(detectCategory('sk-proj-' + 'A1b2'.repeat(8)), 'OpenAI Key');
assert.strictEqual(detectCategory('sk-ant-' + 'A1b2'.repeat(8)), 'Anthropic Key');
// Provider keys default to the block policy.
assert.strictEqual(actionForCategory('GitHub Token', defaults), 'block');
assert.strictEqual(actionForCategory('Stripe Key', defaults), 'block');

// ── Custom rules ──────────────────────────────────────────────────────────────
const withRules = mergeSettings({
  customRules: [
    { name: 'Internal Key', type: 'regex', pattern: 'ACME-[A-Z0-9]{8}' },
    { name: 'Codename', type: 'keyword', pattern: 'Project Falcon' },
    { name: 'Bad', type: 'regex', pattern: '([unclosed' } // invalid → dropped
  ]
});
// Invalid regex rule is stripped during normalization.
assert.strictEqual(withRules.customRules.length, 2);
assert.strictEqual(normalizeCustomRules({ customRules: [{ type: 'regex', pattern: '([' }] }).length, 0);
// Custom regex and keyword rules are detected and labeled with the rule name.
assert.deepStrictEqual(matchingCategories('key ACME-AB12CD34', withRules), ['Internal Key']);
assert.deepStrictEqual(matchingCategories('ship Project Falcon tomorrow', withRules), ['Codename']);
// Custom rules follow the custom-group policy (block by default).
assert.strictEqual(evaluateRegex('key ACME-AB12CD34', withRules).action, 'block');
const customWarn = mergeSettings({ customRules: withRules.customRules, categoryActions: { custom: 'warn' } });
assert.strictEqual(evaluateRegex('key ACME-AB12CD34', customWarn).action, 'warn');

// ── Redaction ────────────────────────────────────────────────────────────────
const red = redactText('email me at test@example.com please', defaults);
assert.strictEqual(red.redactedCount, 1);
assert.strictEqual(red.text, 'email me at [EMAIL] please');
// Multiple spans are each masked.
const red2 = redactText('card 4111 1111 1111 1111 and key AKIA1234567890ABCDEF', defaults);
assert.strictEqual(red2.redactedCount, 2);
assert.ok(red2.text.includes('[CARD]'));
assert.ok(red2.text.includes('[AWS_KEY]'));
// Clean text is returned unchanged with a zero count.
const clean = redactText('nothing sensitive here at all', defaults);
assert.strictEqual(clean.redactedCount, 0);
assert.strictEqual(clean.text, 'nothing sensitive here at all');
// Custom rule spans are redacted too.
const redCustom = redactText('deploy ACME-AB12CD34 now', withRules);
assert.strictEqual(redCustom.redactedCount, 1);
assert.strictEqual(redCustom.text, 'deploy [REDACTED] now');

// ── Redact mode normalization ────────────────────────────────────────────────
assert.strictEqual(mergeSettings({ mode: 'redact' }).mode, 'redact');
assert.strictEqual(mergeSettings({ mode: 'nonsense' }).mode, 'block');

// ── Masked previews (never leak the raw value) ───────────────────────────────
// Short values are fully masked; longer values keep recognizable head/tail.
assert.strictEqual(maskSecret('abcd'), '****');
assert.strictEqual(maskSecret(''), '');
const maskedKey = maskSecret('AKIA1234567890ABCDEF');
assert.ok(maskedKey.startsWith('AKIA'));
assert.ok(maskedKey.endsWith('CDEF'));
assert.ok(maskedKey.includes('*'));
// The full raw secret must not appear in its own mask.
assert.ok(!maskedKey.includes('AKIA1234567890ABCDEF'));

// maskedPreview returns the first span's label and a masked fragment.
const previewAws = maskedPreview('here is AKIA1234567890ABCDEF for you', defaults);
assert.strictEqual(previewAws.label, 'AWS Key');
assert.ok(previewAws.masked.includes('*'));
assert.ok(!previewAws.masked.includes('AKIA1234567890ABCDEF'));
// Clean text has no preview.
assert.strictEqual(maskedPreview('nothing sensitive at all here', defaults), null);
// A disclosure cue phrase (cueOnly) has no maskable span → no preview.
assert.strictEqual(maskedPreview('my name is Jane', defaults), null);
// Custom-rule hits are previewed with the rule name as the label.
const previewCustom = maskedPreview('deploy ACME-AB12CD34 now', withRules);
assert.strictEqual(previewCustom.label, 'Internal Key');
assert.ok(!previewCustom.masked.includes('ACME-AB12CD34'));

console.log('detection-core + site-adapter unit checks passed.');
