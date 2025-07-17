const fs = require('fs');
const path = require('path'); // Node.js path module for resolving local paths

// Import the pipeline and env from the Node.js version of @xenova/transformers
const { pipeline, env } = require('@xenova/transformers');

// Configure environment for local model loading
env.allowRemoteModels = false;
// Use path.join to correctly resolve local file system paths
env.localModelPath = path.join(__dirname, 'web_model/');
env.backends.onnx.wasm.wasmPaths = path.join(__dirname, 'wasm/');

let nerPipeline = null; // Declare nerPipeline globally or outside runTest

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
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,                                       // SSN-like
  /\b(?:\d[ -]?){15}\d\b/g,                                            // 16-digit numbers (credit cards) with spaces/hyphens
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,                    // Emails
  /\b(?:\+?\d{1,3}\s?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,           // Flexible phone numbers (10+ digits, with symbols/spaces)
  /AKIA[0-9A-Z]{16}/g,                                                  // AWS keys
  /AIza[0-9A-Za-z\-_]{35}/g,                                            // Google API keys
  /sk[-_][a-zA-Z0-9]{32,}/g,                                            // Secret keys
  /(?<![A-Za-z0-9])[A-Za-z0-9]{32}(?![A-Za-z0-9])/g,                   // 32-char hashes/tokens
  /(?<![A-Za-z0-9])[A-Za-z0-9]{40}(?![A-Za-z0-9])/g,                   // 40-char hashes/tokens
  /(?<![A-Za-z0-9])[A-Za-z0-9]{64}(?![A-Za-z0-9])/g,                   // 64-char hashes/tokens
  /api[_-]?key\s*[:=]?\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,              // API keys, flexible with separators and quotes
  /secret[_-]?key\s*[:=]?\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,           // Secret keys, flexible with separators and quotes
  /access[_-]?token\s*[:=]?\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,         // Access tokens, flexible with separators and quotes
  /(?<![A-Za-z0-9])(?:[A-Za-z0-9\-_]{16,256})(?![A-Za-z0-9])/g,          // A general pattern for long alphanumeric strings (16-256 chars)
  // New regex patterns for specific PII types that were missed
  /(?:office|personal|system|database|server)\s+password\s+is\s+['"]?[A-Za-z0-9!@#$%^&*()_+=\-]{3,}['"]?/gi, // Generic password phrases
  /(?:medical record number|MRN)[-.\s]?[A-Za-z0-9]{3,}/gi,              // Medical Record Numbers
  /(?:employee id|EMP)[-.\s]?[A-Za-z0-9]{3,}/gi,                        // Employee IDs
  /(?:driver's license number|D)[-.\s]?[A-Za-z0-9]{7,}/gi,              // Driver's License Numbers
  /(?:passport number|P)[-.\s]?[A-Za-z0-9]{7,}/gi                       // Passport Numbers
];

function containsSensitiveRegex(text) {
  return regexPatterns.some(p => p.test(text));
}

// Function to perform BERT-based PII check
async function checkPIIWithBert(text) {
  const model = await loadModel(); // Ensure model is loaded
  try {
    const result = await model(text, { aggregation_strategy: 'simple' });
    const piiTags = ['PER', 'ORG', 'LOC', 'MISC', 'DATE', 'NOC']; // Common PII entity groups
    let hasPII = result.some(ent => piiTags.includes(ent.entity_group));

    // Additional keyword-based checks for general PII that BERT might miss
    const lowerText = text.toLowerCase();
    const additionalPiiKeywords = [
      'my full name is', 'i live at', 'my date of birth is', 'my mother\'s maiden name is',
      'my current location is', 'my medical condition is'
    ];
    const containsAdditionalPii = additionalPiiKeywords.some(keyword => lowerText.includes(keyword));

    if (containsAdditionalPii) {
      hasPII = true; // Override if additional PII keywords are found
      console.log(`Additional keyword check detected PII for text: "${text}"`);
    }


    if (hasPII) {
      console.log(`BERT model detected PII for text: "${text}"`);
      // Optionally, you can log the detected entities for debugging
      // console.log("Detected entities:", result.filter(ent => piiTags.includes(ent.entity_group)));
    }
    return hasPII;
  } catch (e) {
    console.error('BERT inference error:', e);
    return false; // Return false on error
  }
}

const jsonFilePath = 'test_questions.json'; // Ensure this points to your JSON file

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
