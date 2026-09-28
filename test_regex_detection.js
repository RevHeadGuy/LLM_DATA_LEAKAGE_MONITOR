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

// Function to load the BERT model
async function loadModel() {
  if (!nerPipeline) {
    console.log("Loading BERT model (this may take a moment)...");
    nerPipeline = await pipeline('token-classification', 'bert-tiny-ner', { quantized: true });
    console.log("BERT model loaded successfully.");
  }
  return nerPipeline;
}

// Regex patterns to detect sensitive data
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
  /\b(?:my|i)\s+(?:full\s+name|name|address|date\s+of\s+birth|birthdate|mother['’]s\s+maiden\s+name|current\s+location|medical\s+condition|medical\s+record\s+number|employee\s+id|passport\s+number|driver['’]s\s+license\s+number|secret\s+phrase|secret[_\s-]?key|api[_\s-]?key|access[_\s-]?token|ssn|social\s+security|credit\s+card|aws\s+key|google\s+api\s+key|password)\s+(?:is|:|=)/gi,
  /(?:medical record number|MRN)[-.\s]?[A-Za-z0-9]{3,}/gi,
  /(?:employee id|EMP)[-.\s]?[A-Za-z0-9]{3,}/gi,
  /(?:driver['’]s\s+license\s+number\s*(?:is|:|=)\s*D?[A-Za-z0-9]{7,}|(?<![A-Za-z])D[A-Za-z0-9]{7,}(?![A-Za-z]))/gi,
  /(?:passport\s+number\s*(?:is|:|=)\s*P?[A-Za-z0-9]{7,}|(?<![A-Za-z])P[A-Za-z0-9]{7,}(?![A-Za-z]))/gi
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
    'my mother\'s maiden name is', 'my current location is',
    'my medical condition is', 'my medical record number is',
    'my employee id is', 'my passport number is', 'my driver\'s license number is',
    'my office password is', 'my personal password is', 'my system password is',
    'my database password is', 'my server password is', 'my password is',
    'my secret phrase is', 'my secret_key is', 'my secret key is',
    'my api key is', 'my access token is', 'api key', 'secret key',
    'access token', 'ssn', 'social security', 'credit card', 'aws key',
    'google api key', 'token:', 'hash:'
  ];

  return keywordChecks.some((keyword) => lowerText.includes(keyword));
}

// Function to perform BERT-based PII check
async function checkPIIWithBert(text) {
  const model = await loadModel();

  if (!hasStrongPiiContext(text)) {
    return false;
  }

  try {
    const result = await model(text, { aggregation_strategy: 'simple' });
    const piiTags = ['PER', 'ORG', 'LOC', 'MISC'];
    let hasPII = result.some((ent) => piiTags.includes(ent.entity_group) && (ent.score || 0) > 0.8);

    const lowerText = text.toLowerCase();
    const additionalPiiKeywords = [
      'my full name is', 'my name is', 'i live at', 'my date of birth is', 'my mother\'s maiden name is',
      'my current location is', 'my medical condition is', 'my address is', 'my email is',
      'my office password is', 'my personal password is', 'my system password is', 'my database password is',
      'my server password is', 'my secret phrase is', 'my secret key is', 'my api key is', 'my access token is'
    ];
    const containsAdditionalPii = additionalPiiKeywords.some((keyword) => lowerText.includes(keyword));

    if (containsAdditionalPii) {
      hasPII = true;
      console.log(`Additional keyword check detected PII for text: "${text}"`);
    }

    if (hasPII) {
      console.log(`BERT model detected PII for text: "${text}"`);
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
  let incorrectDetections = [];

  console.log(`Running combined detection tests on ${testData.length} entries from ${jsonFilePath}...\n`);

  // Pre-load the BERT model once before starting tests
  await loadModel();

  for (const item of testData) {
    const text = item.text;
    const expected = item.expected_detection;

    // First, try detection with regex
    let actualDetected = containsSensitiveRegex(text);

    // Reset regex lastIndex for global patterns to ensure correct re-evaluation
    regexPatterns.forEach(p => {
        if (p.global) {
            p.lastIndex = 0;
        }
    });

    // If regex didn't detect it, and it's expected to be sensitive,
    // then pass it to the BERT model for a deeper check.
    if (!actualDetected && expected) {
      const piiFromBert = await checkPIIWithBert(text);
      if (piiFromBert) {
        actualDetected = true; // BERT model caught it
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
        text: text,
        expected: expected,
        actual: actualDetected
      });
    }
  }

  console.log(`\n--- Test Results ---`);
  console.log(`Total entries in the JSON file: ${testData.length}`);
  console.log(`Total entries expected to be caught: ${expectedPositives}`);
  console.log(`Total entries actually caught by combined (Regex + BERT): ${actualCombinedPositives}`);
  console.log(`\nSummary:`);
  console.log(`Correct Detections (Actual == Expected): ${correctDetections}`);
  console.log(`Incorrect Detections (Actual != Expected): ${incorrectDetections.length}`);

  if (incorrectDetections.length > 0) {
    console.log(`\nDetails of Incorrect Detections (where combined detection != expected):`);
    for (const incorrect of incorrectDetections) {
      console.log(`  ID: ${incorrect.id}`);
      console.log(`    Text: "${incorrect.text}"`);
      console.log(`    Expected: ${incorrect.expected}`);
      console.log(`    Actual: ${incorrect.actual}`);
    }
  }

  console.log(`\nFinal Results:`);
  console.log(`Expected to catch: ${expectedPositives}`);
  console.log(`Actually caught: ${actualCombinedPositives}`);
}

runTest().catch(console.error);
