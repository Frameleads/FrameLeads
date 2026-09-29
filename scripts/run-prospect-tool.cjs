// Local TypeScript runner using the repository's installed compiler. No downloads or .env loading.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};
const tool = process.argv[2];
if (!['test', 'intelligence-test', 'research-test', 'scout-test', 'qualification-test', 'metadata-test', 'trust-test', 'usage-test', 'company-test', 'handoff-test', 'memory-test', 'brain-test', 'playbook-test', 'constitution-test', 'decision-test', 'automation-test', 'revenue-risk-test', 'response-sla-test', 'decision-sandbox-test', 'decision-replay-test', 'outcome-learning-test', 'diagnostic-test', 'market-messaging-test', 'campaign-session-test', 'entitlements-test', 'entitlement-routes-test', 'backfill'].includes(tool)) throw new Error('Unknown prospect tool');
if (tool === 'diagnostic-test') { require(path.join(__dirname, '../tests/diagnostic.test.ts')); return; }
if (tool === 'market-messaging-test') { require(path.join(__dirname, '../tests/market-messaging.test.ts')); return; }
if (tool === 'campaign-session-test') { require(path.join(__dirname, '../tests/campaign-session.test.ts')); return; }
if (tool === 'entitlements-test') { require(path.join(__dirname, '../tests/entitlements.test.ts')); return; }
if (tool === 'entitlement-routes-test') { require(path.join(__dirname, '../tests/entitlement-routes.test.ts')); return; }
require(path.join(__dirname, tool === 'test' ? '../tests/prospect-identity.test.ts' : tool === 'intelligence-test' ? '../tests/prospect-intelligence.test.ts' : tool === 'research-test' ? '../tests/prospect-research.test.ts' : tool === 'scout-test' ? '../tests/scout.test.ts' : tool === 'qualification-test' ? '../tests/prospect-qualification.test.ts' : tool === 'metadata-test' ? '../tests/prospect-metadata.test.ts' : tool === 'trust-test' ? '../tests/prospect-qualification-trust.test.ts' : tool === 'usage-test' ? '../tests/ai-usage.test.ts' : tool === 'company-test' ? '../tests/company-cache.test.ts' : tool === 'handoff-test' ? '../tests/scout-handoff.test.ts' : tool === 'memory-test' ? '../tests/prospect-memory.test.ts' : tool === 'brain-test' ? '../tests/brain.test.ts' : tool === 'playbook-test' ? '../tests/revenue-playbook.test.ts' : tool === 'constitution-test' ? '../tests/sales-constitution.test.ts' : tool === 'decision-test' ? '../tests/decision-engine.test.ts' : tool === 'automation-test' ? '../tests/automation.test.ts' : tool === 'revenue-risk-test' ? '../tests/revenue-risk.test.ts' : tool === 'response-sla-test' ? '../tests/response-sla.test.ts' : tool === 'decision-sandbox-test' ? '../tests/decision-sandbox.test.ts' : tool === 'decision-replay-test' ? '../tests/decision-replay.test.ts' : tool === 'outcome-learning-test' ? '../tests/outcome-learning.test.ts' : 'backfill-prospects.ts'));
