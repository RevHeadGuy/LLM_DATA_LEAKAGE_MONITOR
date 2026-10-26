'use strict';

/**
 * Shared detection helpers used by the content script (classic MV3) and Node tests.
 * Keep this file free of `export` so it can load as a content script.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.LdlmDetection = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MIN_INPUT_LENGTH = 6;
  const DEFAULT_NER_MIN_SCORE = 0.75;

  const CATEGORY_GROUPS = {
    secrets: [
      'AWS Key', 'Google API Key', 'Secret Key', 'JWT Token', 'Private Key',
      'Connection String', 'OAuth Token', 'API Key', 'Access Token', 'Password',
      'Sensitive Data'
    ],
    identity: ['SSN', 'Credit Card', 'Medical Record', 'Employee ID', "Driver's License", 'Passport', 'IBAN'],
    tokens: ['Hash / Token'],
    contact: ['Email', 'Phone Number'],
    personal: ['Full Name', 'Address'],
    ner: ['PII (NER)', 'Person', 'Organization', 'Location', 'Named Entity'],
    secrets2: [
      'GitHub Token', 'Slack Token', 'Stripe Key', 'OpenAI Key',
      'Anthropic Key', 'SendGrid Key', 'npm Token', 'Twilio Key'
    ],
    custom: ['Custom Rule']
  };

  const DEFAULT_GROUP_ACTIONS = {
    secrets: 'block',
    identity: 'block',
    tokens: 'warn',
    contact: 'warn',
    personal: 'warn',
    ner: 'warn',
    secrets2: 'block',
    custom: 'block'
  };

  const DEFAULT_SETTINGS = {
    mode: 'block',
    allowlist: [],
    scope: 'llm',
    categoryActions: { ...DEFAULT_GROUP_ACTIONS },
    customRules: []
  };

  // Credit-card candidate: 13–19 digits, optionally spaced/dashed in 4-digit
  // groups. The Luhn check in validateLuhn() rejects random digit runs that
  // merely look card-shaped (order numbers, long IDs).
  const CREDIT_CARD_CANDIDATE_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

  const regexPatterns = [
    /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    /\b(?:\+?\d{1,3}\s?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g,
    /AKIA[0-9A-Z]{16}/g,
    /ASIA[0-9A-Z]{12,}/g,
    /AIza[0-9A-Za-z\-_]{35}/g,
    /sk[-_][a-zA-Z0-9]{32,}/g,
    // Provider-specific secret formats
    /gh[pousr]_[A-Za-z0-9]{36,}/g,
    /github_pat_[A-Za-z0-9_]{22,}/g,
    /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    /sk_live_[A-Za-z0-9]{16,}/g,
    /pk_live_[A-Za-z0-9]{16,}/g,
    /rk_live_[A-Za-z0-9]{16,}/g,
    /sk-proj-[A-Za-z0-9_-]{20,}/g,
    /sk-ant-[A-Za-z0-9_-]{20,}/g,
    /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22,}/g,
    /npm_[A-Za-z0-9]{36}/g,
    /SK[0-9a-fA-F]{32}/g,
    /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    /(?:mongodb(?:\+srv)?:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/|redis:\/\/|amqp:\/\/|ssh:\/\/)[^\s<>]+/gi,
    /(?:client[_-]?secret|oauth[_-]?token|refresh[_-]?token|bearer)[\s:=]+['"]?[A-Za-z0-9._~+\/-]+=*['"]?/gi,
    /api[_-]?key\s*(?:[:=]|is)\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
    /secret[_-]?key\s*(?:[:=]|is)\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
    /access[_-]?token\s*(?:[:=]|is)\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
    /(?:office|personal|system|database|server)\s+password\s+(?:is|:|=)\s*['"]?[A-Za-z0-9!@#$%^&*()_+=\-]{3,}['"]?/gi,
    /\b(?:my|i)\s+(?:full\s+name|name|address|date\s+of\s+birth|birthdate|mother['']s\s+maiden\s+name|current\s+location|medical\s+condition|medical\s+record\s+number|employee\s+id|passport\s+number|driver['']s\s+license\s+number|secret\s+phrase|secret[_\s-]?key|api[_\s-]?key|access[_\s-]?token|ssn|social\s+security|credit\s+card|aws\s+key|google\s+api\s+key|password)\s+(?:is|:|=)/gi,
    /(?:medical record number|MRN)[-.\s]?[A-Za-z0-9]{3,}/gi,
    /(?:employee id|EMP)[-.\s]?[A-Za-z0-9]{3,}/gi,
    /driver['']s\s+license\s+(?:number\s+)?(?:is\s+)?[A-Za-z0-9]{7,}/gi,
    /passport\s+(?:number\s+)?(?:is\s+)?[A-Za-z0-9]{7,}/gi,
    /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g
  ];

  const categoryMap = [
    // High-confidence secret/key formats are checked before the looser
    // contact (email/phone) patterns so a token containing a digit run is
    // labeled as the key it is, not misread as a phone number.
    { pattern: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g, label: 'SSN' },
    { pattern: /AKIA[0-9A-Z]{16}/g, label: 'AWS Key' },
    { pattern: /ASIA[0-9A-Z]{12,}/g, label: 'AWS Key' },
    { pattern: /AIza[0-9A-Za-z\-_]{35}/g, label: 'Google API Key' },
    { pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g, label: 'GitHub Token' },
    { pattern: /github_pat_[A-Za-z0-9_]{22,}/g, label: 'GitHub Token' },
    { pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g, label: 'Slack Token' },
    { pattern: /(?:sk|pk|rk)_live_[A-Za-z0-9]{16,}/g, label: 'Stripe Key' },
    { pattern: /sk-proj-[A-Za-z0-9_-]{20,}/g, label: 'OpenAI Key' },
    { pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g, label: 'Anthropic Key' },
    { pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22,}/g, label: 'SendGrid Key' },
    { pattern: /npm_[A-Za-z0-9]{36}/g, label: 'npm Token' },
    { pattern: /SK[0-9a-fA-F]{32}/g, label: 'Twilio Key' },
    { pattern: /sk[-_][a-zA-Z0-9]{32,}/g, label: 'Secret Key' },
    { pattern: /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g, label: 'JWT Token' },
    { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, label: 'Email' },
    { pattern: /\b(?:\+?\d{1,3}\s?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g, label: 'Phone Number' },
    { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, label: 'Private Key' },
    { pattern: /(?:mongodb(?:\+srv)?:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/|redis:\/\/|amqp:\/\/|ssh:\/\/)/gi, label: 'Connection String' },
    { pattern: /(?:client[_-]?secret|oauth[_-]?token|refresh[_-]?token|bearer)[\s:=]+/gi, label: 'OAuth Token' },
    { pattern: /api[_-]?key\s*(?:[:=]|is)\s*/gi, label: 'API Key' },
    { pattern: /secret[_-]?key\s*(?:[:=]|is)\s*/gi, label: 'Secret Key' },
    { pattern: /access[_-]?token\s*(?:[:=]|is)\s*/gi, label: 'Access Token' },
    { pattern: /(?:office|personal|system|database|server)\s+password\s+(?:is|:|=)/gi, label: 'Password' },
    // cueOnly entries match a disclosure *phrase*, not the sensitive value
    // itself, so they drive detection but are skipped by span redaction (we
    // don't want to blank out "my name is" and leave the actual name).
    { pattern: /\b(?:my|i)\s+(?:full\s+name|name)\s+(?:is|:|=)/gi, label: 'Full Name', cueOnly: true },
    { pattern: /\b(?:my|i)\s+(?:address)\s+(?:is|:|=)/gi, label: 'Address', cueOnly: true },
    { pattern: /\b(?:my|i)\s+(?:ssn|social\s+security)\s+(?:is|:|=)/gi, label: 'SSN', cueOnly: true },
    { pattern: /\b(?:my|i)\s+(?:password)\s+(?:is|:|=)/gi, label: 'Password', cueOnly: true },
    { pattern: /\b(?:my|i)\s+(?:credit\s+card)\s+(?:is|:|=)/gi, label: 'Credit Card', cueOnly: true },
    { pattern: /(?:medical record number|MRN)[-.\s]?[A-Za-z0-9]{3,}/gi, label: 'Medical Record' },
    { pattern: /(?:employee id|EMP)[-.\s]?[A-Za-z0-9]{3,}/gi, label: 'Employee ID' },
    { pattern: /driver['']s\s+license/gi, label: "Driver's License", cueOnly: true },
    { pattern: /passport\s+(?:number\s+)?/gi, label: 'Passport', cueOnly: true },
    { pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, label: 'IBAN' }
  ];

  // Candidate opaque tokens (32/40/64 alphanumeric chars) are extracted and
  // vetted by looksLikeSecretToken() instead of matching blindly. This keeps
  // real credentials while ignoring git SHAs, UUIDs, and base64 chunks.
  const HASH_CANDIDATE_RE = /(?<![A-Za-z0-9])(?:[A-Za-z0-9]{32}|[A-Za-z0-9]{40}|[A-Za-z0-9]{64})(?![A-Za-z0-9])/g;

  function detectGenericHash(text) {
    if (!text) return false;
    HASH_CANDIDATE_RE.lastIndex = 0;
    let match;
    while ((match = HASH_CANDIDATE_RE.exec(text)) !== null) {
      if (looksLikeSecretToken(match[0], text)) {
        HASH_CANDIDATE_RE.lastIndex = 0;
        return true;
      }
    }
    HASH_CANDIDATE_RE.lastIndex = 0;
    return false;
  }

  /**
   * Luhn checksum. Real payment-card numbers satisfy this; arbitrary 13–19
   * digit runs (order numbers, long ids) usually do not.
   */
  function validateLuhn(digits) {
    const clean = String(digits).replace(/[^0-9]/g, '');
    if (clean.length < 13 || clean.length > 19) return false;
    let sum = 0;
    let alt = false;
    for (let i = clean.length - 1; i >= 0; i--) {
      let d = clean.charCodeAt(i) - 48;
      if (alt) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  function detectCreditCard(text) {
    if (!text) return false;
    CREDIT_CARD_CANDIDATE_RE.lastIndex = 0;
    let match;
    while ((match = CREDIT_CARD_CANDIDATE_RE.exec(text)) !== null) {
      if (validateLuhn(match[0])) {
        CREDIT_CARD_CANDIDATE_RE.lastIndex = 0;
        return true;
      }
    }
    CREDIT_CARD_CANDIDATE_RE.lastIndex = 0;
    return false;
  }

  const NER_LABEL_MAP = {
    LABEL_0: 'O',
    O: 'O',
    LABEL_1: 'MISC',
    LABEL_2: 'MISC',
    LABEL_3: 'PER',
    LABEL_4: 'PER',
    LABEL_5: 'ORG',
    LABEL_6: 'ORG',
    LABEL_7: 'LOC',
    LABEL_8: 'LOC',
    PER: 'PER',
    PERSON: 'PER',
    ORG: 'ORG',
    ORGANIZATION: 'ORG',
    LOC: 'LOC',
    LOCATION: 'LOC',
    MISC: 'MISC'
  };

  const NER_CATEGORY = {
    PER: 'Person',
    ORG: 'Organization',
    LOC: 'Location',
    MISC: 'Named Entity'
  };

  // Keyword cues that make a long opaque string likely to be a real secret
  // rather than a git SHA, UUID, or base64 chunk pasted into a coding chat.
  const SECRET_CONTEXT_RE = /(?:api|secret|private|access|auth|bearer|session|refresh|client)?[_\s-]?(?:key|token|secret|password|passwd|pwd|credential|cred|hash|signature|sig|nonce|salt)/i;

  /**
   * Shannon entropy (bits per character) of a string. Random secrets have high
   * entropy (~4+); repetitive or low-variety strings score lower.
   */
  function shannonEntropy(str) {
    if (!str) return 0;
    const freq = Object.create(null);
    for (const ch of str) freq[ch] = (freq[ch] || 0) + 1;
    let entropy = 0;
    const len = str.length;
    for (const ch in freq) {
      const p = freq[ch] / len;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  /**
   * Decide whether a long opaque alphanumeric token looks like a real secret.
   * A git SHA (all-hex, often lowercase) or a plain lowercase id should NOT
   * trip the generic hash rule unless there is a secret keyword nearby.
   */
  function looksLikeSecretToken(token, surroundingText) {
    if (!token) return false;
    const hasLower = /[a-z]/.test(token);
    const hasUpper = /[A-Z]/.test(token);
    const hasDigit = /[0-9]/.test(token);
    const mixedCaseWithDigits = hasLower && hasUpper && hasDigit;

    // Pure hexadecimal of these lengths is almost always a git SHA (40),
    // MD5 (32), or SHA-256 (64) checksum — not a credential on its own.
    const isPureHex = /^[0-9a-fA-F]+$/.test(token);

    const context = typeof surroundingText === 'string' ? surroundingText : token;
    const hasKeyword = SECRET_CONTEXT_RE.test(context);

    if (hasKeyword) return true;
    if (isPureHex) return false; // checksum/SHA without any secret cue
    // No keyword: only flag when the token itself is high-entropy and mixed.
    return mixedCaseWithDigits && shannonEntropy(token) >= 3.5;
  }

  function resetRegexState(regex) {
    if (regex.global || regex.sticky) {
      regex.lastIndex = 0;
    }
  }

  /**
   * Turn a stored custom rule into an executable matcher. A rule is
   * { name, type: 'regex'|'keyword', pattern, flags? }. Invalid regex is
   * skipped rather than throwing so one bad rule can't break detection.
   * Returns { label, test(text) } or null.
   */
  function compileCustomRule(rule) {
    if (!rule || typeof rule !== 'object') return null;
    const pattern = typeof rule.pattern === 'string' ? rule.pattern.trim() : '';
    if (!pattern) return null;
    const label = (typeof rule.name === 'string' && rule.name.trim())
      ? rule.name.trim()
      : 'Custom Rule';

    if (rule.type === 'keyword') {
      const needle = pattern.toLowerCase();
      return {
        label,
        isCustom: true,
        test: (text) => String(text || '').toLowerCase().includes(needle)
      };
    }

    // Default: regex. Compile defensively.
    let re;
    try {
      const flags = typeof rule.flags === 'string' ? rule.flags : 'i';
      re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
    } catch (_) {
      return null;
    }
    return {
      label,
      isCustom: true,
      test: (text) => {
        re.lastIndex = 0;
        const hit = re.test(String(text || ''));
        re.lastIndex = 0;
        return hit;
      }
    };
  }

  function compileCustomRules(settings) {
    const rules = settings && Array.isArray(settings.customRules) ? settings.customRules : [];
    return rules.map(compileCustomRule).filter(Boolean);
  }

  function containsSensitiveRegex(text, settings) {
    if (!text) return false;
    const patternHit = regexPatterns.some((p) => {
      const result = p.test(text);
      resetRegexState(p);
      return result;
    });
    if (patternHit || detectGenericHash(text) || detectCreditCard(text)) return true;
    return compileCustomRules(settings).some((rule) => rule.test(text));
  }

  function matchingCategories(text, settings) {
    const hits = [];
    for (const { pattern, label } of categoryMap) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        pattern.lastIndex = 0;
        if (!hits.includes(label)) hits.push(label);
      }
    }
    if (detectCreditCard(text) && !hits.includes('Credit Card')) {
      hits.push('Credit Card');
    }
    if (detectGenericHash(text) && !hits.includes('Hash / Token')) {
      hits.push('Hash / Token');
    }
    for (const rule of compileCustomRules(settings)) {
      if (rule.test(text) && !hits.includes(rule.label)) hits.push(rule.label);
    }
    if (!hits.length && containsSensitiveRegex(text, settings)) hits.push('Sensitive Data');
    return hits;
  }

  function detectCategory(text, settings) {
    const hits = matchingCategories(text, settings);
    return hits[0] || 'Sensitive Data';
  }

  function normalizeCustomRules(raw) {
    const list = raw && Array.isArray(raw.customRules) ? raw.customRules : [];
    const seen = new Set();
    const out = [];
    for (const rule of list) {
      if (!rule || typeof rule !== 'object') continue;
      const pattern = typeof rule.pattern === 'string' ? rule.pattern.trim() : '';
      if (!pattern) continue;
      const type = rule.type === 'keyword' ? 'keyword' : 'regex';
      // Drop rules whose regex won't compile so bad input can't poison storage.
      if (type === 'regex') {
        try {
          new RegExp(pattern);
        } catch (_) {
          continue;
        }
      }
      const name = (typeof rule.name === 'string' && rule.name.trim())
        ? rule.name.trim().slice(0, 60)
        : 'Custom Rule';
      const key = type + '::' + pattern;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = { name, type, pattern };
      if (typeof rule.flags === 'string') entry.flags = rule.flags;
      out.push(entry);
    }
    return out.slice(0, 50);
  }

  function mergeSettings(raw) {
    const next = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    next.allowlist = Array.isArray(next.allowlist) ? next.allowlist : [];
    next.categoryActions = { ...DEFAULT_GROUP_ACTIONS, ...(raw && raw.categoryActions ? raw.categoryActions : {}) };
    next.scope = next.scope === 'all' ? 'all' : 'llm';
    next.customRules = normalizeCustomRules(raw);
    if (!['warn', 'off', 'redact'].includes(next.mode)) next.mode = 'block';
    return next;
  }

  function categoryGroup(label, settings) {
    for (const [group, labels] of Object.entries(CATEGORY_GROUPS)) {
      if (labels.includes(label)) return group;
    }
    // Any label coming from a user-defined rule belongs to the custom group.
    const customNames = settings && Array.isArray(settings.customRules)
      ? settings.customRules.map((r) => (r && r.name ? String(r.name).trim() : ''))
      : [];
    if (customNames.includes(label) || label === 'Custom Rule') return 'custom';
    return 'secrets';
  }

  function capAction(action, mode) {
    if (mode === 'off' || action === 'ignore') return 'ignore';
    if (mode === 'warn' && action === 'block') return 'warn';
    return action;
  }

  function actionForCategory(label, settings) {
    const merged = mergeSettings(settings);
    const group = categoryGroup(label, merged);
    const policy = merged.categoryActions[group] || 'warn';
    return capAction(policy, merged.mode);
  }

  function strongestAction(actions) {
    if (actions.includes('block')) return 'block';
    if (actions.includes('warn')) return 'warn';
    return 'ignore';
  }

  function evaluateRegex(text, settings) {
    const merged = mergeSettings(settings);
    if (!text || text.length < MIN_INPUT_LENGTH) {
      return { action: 'skip', category: null, method: 'regex' };
    }
    const hits = matchingCategories(text, merged);
    if (!hits.length) return { action: 'clean', category: null, method: 'regex' };

    const ranked = hits.map((category) => ({
      category,
      action: actionForCategory(category, merged)
    }));
    const action = strongestAction(ranked.map((r) => r.action));
    const chosen = ranked.find((r) => r.action === action) || ranked[0];
    return {
      action: action === 'ignore' ? 'clean' : action,
      category: chosen.category,
      method: 'regex'
    };
  }

  function normalizeNerLabel(ent) {
    const raw = String(ent.entity_group || ent.entity || '').toUpperCase().replace(/^[BI]-/, '');
    return NER_LABEL_MAP[raw] || (raw && raw !== 'LABEL_0' ? raw : 'O');
  }

  function hasDisclosureContext(text, nerType) {
    if (!text) return false;
    const sample = String(text);
    const personal = /\b(?:my|i)\s+(?:full\s+name|name|address|date\s+of\s+birth|birthdate|mother['']s\s+maiden\s+name|current\s+location|medical\s+condition|medical\s+record|employee\s+id|passport|driver['']s\s+license|ssn|social\s+security|password|email|phone)\b/i;
    const liveAt = /\bi\s+(?:live|reside)\s+(?:at|in)\b/i;
    const named = /\b(?:my name is|i am named|full name is)\b/i;
    if (nerType === 'PER') return named.test(sample) || personal.test(sample);
    if (nerType === 'LOC') return liveAt.test(sample) || /\b(?:my|i)\s+(?:address|current\s+location)\b/i.test(sample);
    if (nerType === 'ORG') return /\b(?:my employer|my company)\b/i.test(sample);
    return personal.test(sample);
  }

  /**
   * Low-level NER gate: non-outside label above the score threshold.
   * Disclosure filtering and category policy live in evaluateNer().
   */
  function nerIndicatesPii(result, minScore = DEFAULT_NER_MIN_SCORE) {
    if (!Array.isArray(result) || result.length === 0) return false;
    return result.some((ent) => {
      const mapped = normalizeNerLabel(ent);
      if (!mapped || mapped === 'O') return false;
      return (Number(ent.score) || 0) > minScore;
    });
  }

  function evaluateNer(text, result, settings, minScore = DEFAULT_NER_MIN_SCORE) {
    const merged = mergeSettings(settings);
    if (!Array.isArray(result) || result.length === 0) {
      return { action: 'clean', category: null, method: 'bert' };
    }

    const hits = [];
    for (const ent of result) {
      const mapped = normalizeNerLabel(ent);
      if (!mapped || mapped === 'O') continue;
      if ((Number(ent.score) || 0) <= minScore) continue;
      if (!hasDisclosureContext(text, mapped)) continue;
      hits.push(NER_CATEGORY[mapped] || 'PII (NER)');
    }

    if (!hits.length) return { action: 'clean', category: null, method: 'bert' };

    const ranked = hits.map((category) => ({
      category,
      action: actionForCategory(category, merged)
    }));
    const action = strongestAction(ranked.map((r) => r.action));
    const chosen = ranked.find((r) => r.action === action) || ranked[0];
    return {
      action: action === 'ignore' ? 'clean' : action,
      category: chosen.category,
      method: 'bert'
    };
  }

  // Short placeholder tokens used by redaction, keyed by category label.
  const REDACTION_PLACEHOLDER = {
    'Email': '[EMAIL]',
    'Phone Number': '[PHONE]',
    'SSN': '[SSN]',
    'Credit Card': '[CARD]',
    'IBAN': '[IBAN]',
    'AWS Key': '[AWS_KEY]',
    'Google API Key': '[API_KEY]',
    'GitHub Token': '[TOKEN]',
    'Slack Token': '[TOKEN]',
    'Stripe Key': '[API_KEY]',
    'OpenAI Key': '[API_KEY]',
    'Anthropic Key': '[API_KEY]',
    'SendGrid Key': '[API_KEY]',
    'npm Token': '[TOKEN]',
    'Twilio Key': '[API_KEY]',
    'Secret Key': '[SECRET]',
    'API Key': '[API_KEY]',
    'Access Token': '[TOKEN]',
    'OAuth Token': '[TOKEN]',
    'JWT Token': '[JWT]',
    'Private Key': '[PRIVATE_KEY]',
    'Connection String': '[CONNECTION_STRING]',
    'Password': '[PASSWORD]',
    'Hash / Token': '[TOKEN]'
  };

  function placeholderFor(label) {
    return REDACTION_PLACEHOLDER[label] || '[REDACTED]';
  }

  /**
   * Collect [start, end) spans of sensitive substrings, labeled by category.
   * Covers the built-in labeled patterns, Luhn-validated cards, vetted generic
   * tokens, and user custom rules. Spans are returned sorted and non-empty.
   */
  function sensitiveSpans(text, settings) {
    if (!text) return [];
    const merged = mergeSettings(settings);
    const spans = [];

    const push = (start, end, label) => {
      if (end > start) spans.push({ start, end, label });
    };

    for (const { pattern, label, cueOnly } of categoryMap) {
      // Cue phrases ("my name is") drive detection but aren't the value to mask.
      if (cueOnly) continue;
      const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m[0] === '') { re.lastIndex++; continue; }
        push(m.index, m.index + m[0].length, label);
      }
    }

    // Luhn-validated credit cards.
    CREDIT_CARD_CANDIDATE_RE.lastIndex = 0;
    let cc;
    while ((cc = CREDIT_CARD_CANDIDATE_RE.exec(text)) !== null) {
      if (validateLuhn(cc[0])) push(cc.index, cc.index + cc[0].length, 'Credit Card');
    }
    CREDIT_CARD_CANDIDATE_RE.lastIndex = 0;

    // Vetted generic opaque tokens.
    HASH_CANDIDATE_RE.lastIndex = 0;
    let h;
    while ((h = HASH_CANDIDATE_RE.exec(text)) !== null) {
      if (looksLikeSecretToken(h[0], text)) push(h.index, h.index + h[0].length, 'Hash / Token');
    }
    HASH_CANDIDATE_RE.lastIndex = 0;

    // Custom rules: keyword rules mask the literal keyword; regex rules mask matches.
    for (const rule of (merged.customRules || [])) {
      if (rule.type === 'keyword') {
        const needle = rule.pattern.toLowerCase();
        const lower = text.toLowerCase();
        let idx = lower.indexOf(needle);
        while (idx !== -1) {
          push(idx, idx + needle.length, rule.name);
          idx = lower.indexOf(needle, idx + needle.length);
        }
      } else {
        let re;
        try {
          const flags = typeof rule.flags === 'string' ? rule.flags : 'i';
          re = new RegExp(rule.pattern, flags.includes('g') ? flags : flags + 'g');
        } catch (_) {
          continue;
        }
        let m;
        while ((m = re.exec(text)) !== null) {
          if (m[0] === '') { re.lastIndex++; continue; }
          push(m.index, m.index + m[0].length, rule.name);
        }
      }
    }

    return spans.sort((a, b) => a.start - b.start || b.end - a.end);
  }

  /**
   * Replace every sensitive span in text with a category placeholder, merging
   * overlapping spans so nested matches don't produce doubled placeholders.
   * Returns { text, redactedCount }.
   */
  function redactText(text, settings) {
    const source = String(text || '');
    const spans = sensitiveSpans(source, settings);
    if (!spans.length) return { text: source, redactedCount: 0 };

    // Merge overlaps, keeping the first span's label for the merged range.
    const merged = [];
    for (const span of spans) {
      const last = merged[merged.length - 1];
      if (last && span.start < last.end) {
        last.end = Math.max(last.end, span.end);
      } else {
        merged.push({ ...span });
      }
    }

    let out = '';
    let cursor = 0;
    for (const span of merged) {
      out += source.slice(cursor, span.start) + placeholderFor(span.label);
      cursor = span.end;
    }
    out += source.slice(cursor);
    return { text: out, redactedCount: merged.length };
  }

  /**
   * Mask a single matched value so it can be logged without storing the
   * secret. Keeps a few leading/trailing characters for recognizability and
   * replaces the middle with asterisks; very short values are fully masked.
   * Example: "sk-proj-ABCDEF123456" -> "sk-p**********3456".
   */
  function maskSecret(value) {
    const raw = String(value || '');
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (trimmed.length <= 4) return '*'.repeat(trimmed.length);

    const keep = trimmed.length <= 8 ? 1 : trimmed.length <= 16 ? 3 : 4;
    const head = trimmed.slice(0, keep);
    const tail = trimmed.slice(-keep);
    const midLen = Math.max(2, Math.min(10, trimmed.length - keep * 2));
    return `${head}${'*'.repeat(midLen)}${tail}`;
  }

  /**
   * Build a safe, loggable preview of the first sensitive span in text.
   * Returns { label, masked } or null when nothing maskable is found. The
   * raw secret is never returned — only a masked fragment and its category.
   */
  function maskedPreview(text, settings) {
    const source = String(text || '');
    const spans = sensitiveSpans(source, settings);
    if (!spans.length) return null;
    const first = spans[0];
    return {
      label: first.label,
      masked: maskSecret(source.slice(first.start, first.end))
    };
  }

  return {
    MIN_INPUT_LENGTH,
    DEFAULT_NER_MIN_SCORE,
    DEFAULT_SETTINGS,
    DEFAULT_GROUP_ACTIONS,
    CATEGORY_GROUPS,
    regexPatterns,
    containsSensitiveRegex,
    matchingCategories,
    detectGenericHash,
    detectCreditCard,
    validateLuhn,
    looksLikeSecretToken,
    shannonEntropy,
    detectCategory,
    mergeSettings,
    normalizeCustomRules,
    compileCustomRules,
    categoryGroup,
    actionForCategory,
    evaluateRegex,
    evaluateNer,
    nerIndicatesPii,
    hasDisclosureContext,
    normalizeNerLabel,
    sensitiveSpans,
    redactText,
    placeholderFor,
    maskSecret,
    maskedPreview
  };
});
