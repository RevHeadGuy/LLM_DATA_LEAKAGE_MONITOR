const fs = require('fs');
const path = require('path');
const { containsSensitiveRegex, nerIndicatesPii, evaluateNer, mergeSettings } = require('./detection-core.js');

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
    console.log('Loading BERT model (this may take a moment)...');
    nerPipeline = await pipeline('token-classification', 'bert-tiny-ner', { quantized: true });
    console.log('BERT model loaded successfully.');
  }
  return nerPipeline;
}

function assertNerHelper() {
  const cases = [
    { result: [{ entity_group: 'LABEL_3', score: 0.91 }], expected: true },
    { result: [{ entity: 'LABEL_0', score: 0.99 }], expected: false },
    { result: [{ entity_group: 'LABEL_0', score: 0.99 }], expected: false },
    { result: [{ entity: 'LABEL_4', score: 0.4 }], expected: false },
    { result: [{ entity: 'B-PER', score: 0.82 }], expected: true },
    { result: [{ entity: 'O', score: 0.99 }], expected: false },
    { result: [], expected: false }
  ];

  for (const item of cases) {
    const actual = nerIndicatesPii(item.result);
    if (actual !== item.expected) {
      throw new Error(
        `nerIndicatesPii mismatch: expected ${item.expected} for ${JSON.stringify(item.result)}, got ${actual}`
      );
    }
  }
  console.log('nerIndicatesPii helper checks passed.\n');
}

// Mirrors libs/page-injected-module.js — no extra keyword gates.
async function checkPIIWithBert(text) {
  const model = await loadModel();
  try {
    const result = await model(text, { aggregation_strategy: 'simple' });
    const decision = evaluateNer(text, result, mergeSettings(null));
    const hasPII = decision.action === 'block' || decision.action === 'warn';
    if (hasPII) {
      console.log(`BERT model detected PII (${decision.category}): "${text}"`);
    }
    return hasPII;
  } catch (e) {
    console.error('BERT inference error:', e);
    return false;
  }
}

const jsonFilePath = path.join(__dirname, 'test_questions.json');

async function runTest() {
  assertNerHelper();

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

  await loadModel();

  for (const item of testData) {
    const text = item.text;
    const expected = item.expected_detection;

    let actualDetected = containsSensitiveRegex(text);

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
