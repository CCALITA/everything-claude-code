/**
 * Tests for scripts/opencode/convert.js
 *
 * Run with: node tests/scripts/opencode-convert.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function rmDirSafe(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function readUtf8(p) {
  return fs.readFileSync(p, 'utf8');
}

function runTests() {
  console.log('\n=== Testing opencode converter ===\n');

  const repoRoot = path.join(__dirname, '../..');
  const scriptPath = path.join(repoRoot, 'scripts', 'opencode', 'convert.js');
  const outDir = path.join(repoRoot, '.opencode');

  let passed = 0;
  let failed = 0;

  if (test('converter script exists', () => {
    assert.ok(fs.existsSync(scriptPath), 'Missing scripts/opencode/convert.js');
  })) passed++; else failed++;

  if (test('converter generates .opencode outputs', () => {
    rmDirSafe(outDir);

    const result = spawnSync('node', [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.strictEqual(result.status, 0, `Expected exit code 0. stderr: ${result.stderr || ''}`);
    assert.ok(fs.existsSync(outDir), 'Expected .opencode directory to be created');

    // Agents
    const plannerAgentPath = path.join(outDir, 'agents', 'planner.md');
    assert.ok(fs.existsSync(plannerAgentPath), 'Expected .opencode/agents/planner.md');
    const plannerAgent = readUtf8(plannerAgentPath);
    assert.ok(/\bmode:\s*subagent\b/.test(plannerAgent), 'Expected mode: subagent in planner agent');
    assert.ok(/\bmodel:\s*opencode\/minimax-m2\.5-free\b/.test(plannerAgent), 'Expected mapped opus model in planner agent');
    assert.ok(/\btools:\s*[\s\S]*\bwrite:\s*false\b/.test(plannerAgent), 'Expected write: false in planner agent');

    // Commands (note: source commands/code-review.md has no frontmatter)
    const codeReviewCmdPath = path.join(outDir, 'commands', 'code-review.md');
    assert.ok(fs.existsSync(codeReviewCmdPath), 'Expected .opencode/commands/code-review.md');
    const codeReviewCmd = readUtf8(codeReviewCmdPath);
    assert.ok(codeReviewCmd.startsWith('---'), 'Expected command frontmatter');
    assert.ok(/\bdescription:\s*/.test(codeReviewCmd), 'Expected description in command frontmatter');

    // Skills
    const tddSkillPath = path.join(outDir, 'skills', 'tdd-workflow', 'SKILL.md');
    assert.ok(fs.existsSync(tddSkillPath), 'Expected .opencode/skills/tdd-workflow/SKILL.md');

    // Rules + opencode.json instructions
    const rulesPath = path.join(outDir, 'rules', 'common', 'coding-style.md');
    assert.ok(fs.existsSync(rulesPath), 'Expected .opencode/rules/common/coding-style.md');

    const opencodeJsonPath = path.join(outDir, 'opencode.json');
    assert.ok(fs.existsSync(opencodeJsonPath), 'Expected .opencode/opencode.json');
    const opencodeJson = JSON.parse(readUtf8(opencodeJsonPath));
    assert.ok(Array.isArray(opencodeJson.instructions), 'Expected opencode.json to include instructions array');
    assert.ok(opencodeJson.instructions.includes('rules/**/*.md'), 'Expected opencode.json instructions to include rules glob');

    // MCP servers
    assert.ok(opencodeJson.mcp && typeof opencodeJson.mcp === 'object', 'Expected opencode.json to include mcp object');
    assert.ok(opencodeJson.mcp.github, 'Expected github MCP server to exist');
    assert.strictEqual(opencodeJson.mcp.github.type, 'local');
    assert.ok(Array.isArray(opencodeJson.mcp.github.command), 'Expected github MCP command array');
    assert.strictEqual(opencodeJson.mcp.github.command[0], 'npx');

    assert.ok(opencodeJson.mcp.vercel, 'Expected vercel MCP server to exist');
    assert.strictEqual(opencodeJson.mcp.vercel.type, 'remote');
    assert.ok(typeof opencodeJson.mcp.vercel.url === 'string' && opencodeJson.mcp.vercel.url.includes('vercel'), 'Expected vercel MCP url');
  })) passed++; else failed++;

  if (test('converter is idempotent (can run twice)', () => {
    const result = spawnSync('node', [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    assert.strictEqual(result.status, 0, `Second run should succeed. stderr: ${result.stderr || ''}`);
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
