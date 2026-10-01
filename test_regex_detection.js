const fs = require('fs');
const path = require('path');

let pipeline;
let env;
try {
  ({ pipeline, env } = require('@xenova/transformers'));
} catch (error) {
  console.error('Missing dependency: run "npm install" before executing this script.');
  process.exit(1);
}

env.allowRemoteModels = false;
env.localModelPath = path.join(__dirname, 'web_model/');
env.backends.onnx.wasm.wasmPaths = path.join(__dirname, 'wasm/');

let nerPipeline = null;

async function loadModel() {
  if (!nerPipeline) {
    console.log("Loading BERT model (this may take a moment)...");
    nerPipeline = await pipeline('token-classification', 'bert-tiny-ner', { quantized: true });
    console.log("BERT model loaded successfully.");
  }
  return nerPipeline;
}

// ─── Regex patterns ────────────────────────────────────────────────────────────
// IMPORTANT: keep these in sync with the regexPatterns array in content.js.
// Any divergence means test results will not reflect real extension behaviour.
const regexPatterns = [
  // SSN
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,
  // Generic 16-digit card-like numbers
  /\b(?:\d[ -]?){15}\d\b/g,
  // Credit card numbers (Visa, MC, Amex, Discover, etc.)
  /(?:3[47]\d{13}|(?:4|5|6)\d{15}|3(?:0[0-5]|[68]\d)\d{11}|(?:2131|1800)\d{11})\b/g,
  // Email
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // Phone number
  /\b(?:\+?\d{1,3}\s?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g,
  // AWS access key IDs
  /AKIA[0-9A-Z]{16}/g,
  // AWS temporary access key IDs
  /ASIA[0-9A-Z]{12,}/g,
  // Google API key
  /AIza[0-9A-Za-z\-_]{35}/g,
  // Generic secret key (sk-... style)
  /sk[-_][a-zA-Z0-9]{32,}/g,
  // JWT
  /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,
  // PEM private key block
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  // Connection strings
  /(?:mongodb(?:\+srv)?:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/|redis:\/\/|amqp:\/\/|ssh:\/\/)[^\s<>]+/gi,
  // OAuth / bearer tokens
  /(?:client[_-]?secret|oauth[_-]?token|refresh[_-]?token|bearer)[\s:=]+['"]?[A-Za-z0-9._~+\/-]+=*['"]?/gi,
  // Bare hashes / tokens by length
  /(?<![A-Za-z0-9])[A-Za-z0-9]{32}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])[A-Za-z0-9]{40}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])[A-Za-z0-9]{64}(?![A-Za-z0-9])/g,
  // API / secret / access-token assignments — accept ":", "=", OR "is"
  /api[_-]?key\s*(?:[:=]|is)\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
  /secret[_-]?key\s*(?:[:=]|is)\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
  /access[_-]?token\s*(?:[:=]|is)\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
  // Passwords with context label (is / : / =)
  /(?:office|personal|system|database|server)\s+password\s+(?:is|:|=)\s*['"]?[A-Za-z0-9!@#$%^&*()_+=\-]{3,}['"]?/gi,
  // "My <field> is ..." catch-all for common PII disclosures
  /\b(?:my|i)\s+(?:full\s+name|name|address|date\s+of\s+birth|birthdate|mother['']s\s+maiden\s+name|current\s+location|medical\s+condition|medical\s+record\s+number|employee\s+id|passport\s+number|driver['']s\s+license\s+number|secret\s+phrase|secret[_\s-]?key|api[_\s-]?key|access[_\s-]?token|ssn|social\s+security|credit\s+card|aws\s+key|google\s+api\s+key|password)\s+(?:is|:|=)/gi,
  // Medical record number
  /(?:medical record number|MRN)[-.\s]?[A-Za-z0-9]{3,}/gi,
  // Employee ID
  /(?:employee id|EMP)[-.\s]?[A-Za-z0-9]{3,}/gi,
  // Driver's license — only match when full label is present
  /driver['']s\s+license\s+(?:number\s+)?(?:is\s+)?[A-Za-z0-9]{7,}/gi,
  // Passport — only match when full label is present
  /passport\s+(?:number\s+)?(?:is\s+)?[A-Za-z0-9]{7,}/gi
];

function containsSensitiveRegex(text) {
  return regexPatterns.some((p) => {
    const result = p.test(text);
    p.lastIndex = 0;
    return result;
  });
}

function hasStrongPiiContext(text) {
  const lowerText = text.toLowerCase();
  const keywordChecks = [
    'my name is', 'my full name is', 'my address is', 'my email is',
    'my phone', 'my birthdate is', 'my date of birth is',
    "my mother's maiden name is", 'my current location is',
    'my medical condition is', 'my medical record number is',
    'my employee id is', 'my passport number is', "my driver's license number is",
    'my office password is', 'my personal password is', 'my system password is',
    'my database password is', 'my server password is', 'my password is',
    'my secret phrase is', 'my secret_key is', 'my secret key is',
    'my api key is', 'my access token is', 'api key', 'secret key',
    'access token', 'ssn', 'social security', 'credit card', 'aws key',
    'google api key', 'token:', 'hash:'
  ];

  return keywordChecks.some((keyword) => lowerText.includes(keyword));
}

// BERT-based PII check (mirrors the logic in page-injected-module.js)
async function checkPIIWithBert(text) {
  const model = await loadModel();

  if (!hasStrongPiiContext(text)) {
    return false;
  }

  try {
    const result = await model(text, { aggregation_strategy: 'simple' });

    // Model uses numeric LABEL_* tags — any label other than LABEL_0 with score > 0.5 is PII
    let hasPII = result.some(
      (ent) => ent.entity_group !== 'LABEL_0' && (ent.score || 0) > 0.5
    );

    // Keyword fallback for PII the model may miss
    const lowerText = text.toLowerCase();
    const additionalPiiKeywords = [
      'my full name is', 'my name is', 'i live at', 'my date of birth is',
      "my mother's maiden name is", 'my current location is', 'my medical condition is',
      'my address is', 'my email is', 'my office password is', 'my personal password is',
      'my system password is', 'my database password is', 'my server password is',
      'my secret phrase is', 'my secret key is', 'my api key is', 'my access token is'
    ];
    if (additionalPiiKeywords.some((kw) => lowerText.includes(kw))) {
      hasPII = true;
      console.log(`Keyword fallback detected PII: "${text}"`);
    }

    if (hasPII) {
      console.log(`BERT model detected PII: "${text}"`);
    }
    return hasPII;
  } catch (e) {
    console.error('BERT inference error:', e);
    return false;
  }
}

const jsonFilePath = path.join(__dirname, 'test_questions.json');

async function runTest() {
  let testData;
  try {
    const rawData = fs.readFileSync(jsonFilePath, 'utf8');
    testData = JSON.parse(rawData);
  } catch (error) {
    console.error(`Error reading or parsing JSON file at ${jsonFilePath}:`, error);
    return;
  }

  let expectedPositives = 0;
  let actualCombinedPositives = 0;
  let correctDetections = 0;
  const incorrectDetections = [];

  console.log(`Running combined detection tests on ${testData.length} entries from ${jsonFilePath}...\n`);

  // Pre-load the BERT model once before running all tests
  await loadModel();

  for (const item of testData) {
    const text = item.text;
    const expected = item.expected_detection;

    // Layer 1: regex
    let actualDetected = containsSensitiveRegex(text);

    // Layer 2: BERT (only when regex missed and detection is expected, to save time)
    if (!actualDetected) {
      const piiFromBert = await checkPIIWithBert(text);
      if (piiFromBert) {
        actualDetected = true;
      }
    }

    if (expected) {
      expectedPositives++;
    }

    if (actualDetected) {
      actualCombinedPositives++;
    }

    if (actualDetected === expected) {
      correctDetections++;
    } else {
      incorrectDetections.push({
        id: item.id,
        text,
        expected,
        actual: actualDetected
      });
    }
  }

  console.log(`\n--- Test Results ---`);
  console.log(`Total entries:              ${testData.length}`);
  console.log(`Expected to be caught:      ${expectedPositives}`);
  console.log(`Actually caught (Regex+BERT): ${actualCombinedPositives}`);
  console.log(`Correct detections:         ${correctDetections}`);
  console.log(`Incorrect detections:       ${incorrectDetections.length}`);

  if (incorrectDetections.length > 0) {
    console.log(`\nDetails of incorrect detections:`);
    for (const item of incorrectDetections) {
      console.log(`  ID: ${item.id}`);
      console.log(`    Text:     "${item.text}"`);
      console.log(`    Expected: ${item.expected}`);
      console.log(`    Actual:   ${item.actual}`);
    }
  }

  const accuracy = ((correctDetections / testData.length) * 100).toFixed(1);
  console.log(`\nAccuracy: ${accuracy}% (${correctDetections}/${testData.length})`);
}

runTest().catch(console.error);
