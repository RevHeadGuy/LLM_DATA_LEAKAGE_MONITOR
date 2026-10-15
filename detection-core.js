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
    identity: ['SSN', 'Credit Card', 'Medical Record', 'Employee ID', "Driver's License", 'Passport'],
    tokens: ['Hash / Token'],
    contact: ['Email', 'Phone Number'],
    personal: ['Full Name', 'Address'],
    ner: ['PII (NER)', 'Person', 'Organization', 'Location', 'Named Entity']
  };

  const DEFAULT_GROUP_ACTIONS = {
    secrets: 'block',
    identity: 'block',
    tokens: 'warn',
    contact: 'warn',
    personal: 'warn',
    ner: 'warn'
  };

  const DEFAULT_SETTINGS = {
    mode: 'block',
    allowlist: [],
    scope: 'llm',
    categoryActions: { ...DEFAULT_GROUP_ACTIONS }
  };

  const regexPatterns = [
    /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,
    /\b(?:\d[ -]?){15}\d\b/g,
    /(?:3[47]\d{13}|(?:4|5|6)\d{15}|3(?:0[0-5]|[68]\d)\d{11}|(?:2131|1800)\d{11})\b/g,
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    /\b(?:\+?\d{1,3}\s?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g,
    /AKIA[0-9A-Z]{16}/g,
    /ASIA[0-9A-Z]{12,}/g,
    /AIza[0-9A-Za-z\-_]{35}/g,
    /sk[-_][a-zA-Z0-9]{32,}/g,
    /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    /(?:mongodb(?:\+srv)?:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/|redis:\/\/|amqp:\/\/|ssh:\/\/)[^\s<>]+/gi,
    /(?:client[_-]?secret|oauth[_-]?token|refresh[_-]?token|bearer)[\s:=]+['"]?[A-Za-z0-9._~+\/-]+=*['"]?/gi,
    /(?<![A-Za-z0-9])[A-Za-z0-9]{32}(?![A-Za-z0-9])/g,
    /(?<![A-Za-z0-9])[A-Za-z0-9]{40}(?![A-Za-z0-9])/g,
    /(?<![A-Za-z0-9])[A-Za-z0-9]{64}(?![A-Za-z0-9])/g,
    /api[_-]?key\s*(?:[:=]|is)\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
    /secret[_-]?key\s*(?:[:=]|is)\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
    /access[_-]?token\s*(?:[:=]|is)\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
    /(?:office|personal|system|database|server)\s+password\s+(?:is|:|=)\s*['"]?[A-Za-z0-9!@#$%^&*()_+=\-]{3,}['"]?/gi,
    /\b(?:my|i)\s+(?:full\s+name|name|address|date\s+of\s+birth|birthdate|mother['']s\s+maiden\s+name|current\s+location|medical\s+condition|medical\s+record\s+number|employee\s+id|passport\s+number|driver['']s\s+license\s+number|secret\s+phrase|secret[_\s-]?key|api[_\s-]?key|access[_\s-]?token|ssn|social\s+security|credit\s+card|aws\s+key|google\s+api\s+key|password)\s+(?:is|:|=)/gi,
    /(?:medical record number|MRN)[-.\s]?[A-Za-z0-9]{3,}/gi,
    /(?:employee id|EMP)[-.\s]?[A-Za-z0-9]{3,}/gi,
    /driver['']s\s+license\s+(?:number\s+)?(?:is\s+)?[A-Za-z0-9]{7,}/gi,
    /passport\s+(?:number\s+)?(?:is\s+)?[A-Za-z0-9]{7,}/gi
  ];

  const categoryMap = [
    { pattern: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g, label: 'SSN' },
    { pattern: /\b(?:\d[ -]?){15}\d\b/g, label: 'Credit Card' },
    { pattern: /(?:3[47]\d{13}|(?:4|5|6)\d{15}|3(?:0[0-5]|[68]\d)\d{11}|(?:2131|1800)\d{11})\b/g, label: 'Credit Card' },
    { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, label: 'Email' },
    { pattern: /\b(?:\+?\d{1,3}\s?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g, label: 'Phone Number' },
    { pattern: /AKIA[0-9A-Z]{16}/g, label: 'AWS Key' },
    { pattern: /ASIA[0-9A-Z]{12,}/g, label: 'AWS Key' },
    { pattern: /AIza[0-9A-Za-z\-_]{35}/g, label: 'Google API Key' },
    { pattern: /sk[-_][a-zA-Z0-9]{32,}/g, label: 'Secret Key' },
    { pattern: /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g, label: 'JWT Token' },
    { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, label: 'Private Key' },
    { pattern: /(?:mongodb(?:\+srv)?:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/|redis:\/\/|amqp:\/\/|ssh:\/\/)/gi, label: 'Connection String' },
    { pattern: /(?:client[_-]?secret|oauth[_-]?token|refresh[_-]?token|bearer)[\s:=]+/gi, label: 'OAuth Token' },
    { pattern: /api[_-]?key\s*(?:[:=]|is)\s*/gi, label: 'API Key' },
    { pattern: /secret[_-]?key\s*(?:[:=]|is)\s*/gi, label: 'Secret Key' },
    { pattern: /access[_-]?token\s*(?:[:=]|is)\s*/gi, label: 'Access Token' },
    { pattern: /(?:office|personal|system|database|server)\s+password\s+(?:is|:|=)/gi, label: 'Password' },
    { pattern: /\b(?:my|i)\s+(?:full\s+name|name)\s+(?:is|:|=)/gi, label: 'Full Name' },
    { pattern: /\b(?:my|i)\s+(?:address)\s+(?:is|:|=)/gi, label: 'Address' },
    { pattern: /\b(?:my|i)\s+(?:ssn|social\s+security)\s+(?:is|:|=)/gi, label: 'SSN' },
    { pattern: /\b(?:my|i)\s+(?:password)\s+(?:is|:|=)/gi, label: 'Password' },
    { pattern: /\b(?:my|i)\s+(?:credit\s+card)\s+(?:is|:|=)/gi, label: 'Credit Card' },
    { pattern: /(?:medical record number|MRN)[-.\s]?[A-Za-z0-9]{3,}/gi, label: 'Medical Record' },
    { pattern: /(?:employee id|EMP)[-.\s]?[A-Za-z0-9]{3,}/gi, label: 'Employee ID' },
    { pattern: /driver['']s\s+license/gi, label: "Driver's License" },
    { pattern: /passport\s+(?:number\s+)?/gi, label: 'Passport' },
    { pattern: /(?<![A-Za-z0-9])[A-Za-z0-9]{64}(?![A-Za-z0-9])/g, label: 'Hash / Token' },
    { pattern: /(?<![A-Za-z0-9])[A-Za-z0-9]{40}(?![A-Za-z0-9])/g, label: 'Hash / Token' },
    { pattern: /(?<![A-Za-z0-9])[A-Za-z0-9]{32}(?![A-Za-z0-9])/g, label: 'Hash / Token' }
  ];

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

  function resetRegexState(regex) {
    if (regex.global || regex.sticky) {
      regex.lastIndex = 0;
    }
  }

  function containsSensitiveRegex(text) {
    if (!text) return false;
    return regexPatterns.some((p) => {
      const result = p.test(text);
      resetRegexState(p);
      return result;
    });
  }

  function matchingCategories(text) {
    const hits = [];
    for (const { pattern, label } of categoryMap) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        pattern.lastIndex = 0;
        if (!hits.includes(label)) hits.push(label);
      }
    }
    if (!hits.length && containsSensitiveRegex(text)) hits.push('Sensitive Data');
    return hits;
  }

  function detectCategory(text) {
    const hits = matchingCategories(text);
    return hits[0] || 'Sensitive Data';
  }

  function mergeSettings(raw) {
    const next = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    next.allowlist = Array.isArray(next.allowlist) ? next.allowlist : [];
    next.categoryActions = { ...DEFAULT_GROUP_ACTIONS, ...(raw && raw.categoryActions ? raw.categoryActions : {}) };
    next.scope = next.scope === 'all' ? 'all' : 'llm';
    if (next.mode !== 'warn' && next.mode !== 'off') next.mode = 'block';
    return next;
  }

  function categoryGroup(label) {
    for (const [group, labels] of Object.entries(CATEGORY_GROUPS)) {
      if (labels.includes(label)) return group;
    }
    return 'secrets';
  }

  function capAction(action, mode) {
    if (mode === 'off' || action === 'ignore') return 'ignore';
    if (mode === 'warn' && action === 'block') return 'warn';
    return action;
  }

  function actionForCategory(label, settings) {
    const merged = mergeSettings(settings);
    const group = categoryGroup(label);
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
    const hits = matchingCategories(text);
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

  return {
    MIN_INPUT_LENGTH,
    DEFAULT_NER_MIN_SCORE,
    DEFAULT_SETTINGS,
    DEFAULT_GROUP_ACTIONS,
    CATEGORY_GROUPS,
    regexPatterns,
    containsSensitiveRegex,
    matchingCategories,
    detectCategory,
    mergeSettings,
    categoryGroup,
    actionForCategory,
    evaluateRegex,
    evaluateNer,
    nerIndicatesPii,
    hasDisclosureContext,
    normalizeNerLabel
  };
});
