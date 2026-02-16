#!/usr/bin/env node
/*
 * Convert Claude Code-style ECC config into OpenCode config directories.
 *
 * Source of truth:
 * - agents/*.md
 * - commands/*.md
 * - skills/**
 *
 * Output:
 * - .opencode/agents/*.md
 * - .opencode/commands/*.md
 * - .opencode/skills/**
 *
 * Usage:
 *   node scripts/opencode/convert.js
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');

const SRC_AGENTS_DIR = path.join(REPO_ROOT, 'agents');
const SRC_COMMANDS_DIR = path.join(REPO_ROOT, 'commands');
const SRC_SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const SRC_RULES_DIR = path.join(REPO_ROOT, 'rules');
const SRC_MCP_CONFIG_PATH = path.join(REPO_ROOT, 'mcp-configs', 'mcp-servers.json');

const OUT_DIR = path.join(REPO_ROOT, '.opencode');
const OUT_AGENTS_DIR = path.join(OUT_DIR, 'agents');
const OUT_COMMANDS_DIR = path.join(OUT_DIR, 'commands');
const OUT_SKILLS_DIR = path.join(OUT_DIR, 'skills');
const OUT_RULES_DIR = path.join(OUT_DIR, 'rules');

// Static defaults (no env overrides).
// Keep these fully-qualified (provider/model).
const DEFAULT_MAIN_MODEL = 'opencode/minimax-m2.5-free';
const DEFAULT_FAST_MODEL = 'opencode/minimax-m2.5-free';

function stripBom(s) {
  return s.replace(/^\uFEFF/, '');
}

function splitFrontmatter(markdown) {
  const content = stripBom(markdown);
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontmatter: null, body: content };
  }
  const fmRaw = match[1];
  const body = content.slice(match[0].length);
  return { frontmatter: parseSimpleFrontmatter(fmRaw), body };
}

function parseSimpleFrontmatter(fmRaw) {
  // Minimal parser: key: value per line.
  // Values can be JSON arrays (e.g. tools: ["Read", "Grep"]).
  const out = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();

    // Unquote simple quoted strings
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Try JSON for arrays/objects
    if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
      try {
        out[key] = JSON.parse(value);
        continue;
      } catch {
        // fall through
      }
    }

    out[key] = value;
  }
  return out;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function rmDirSafe(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function readUtf8(p) {
  return fs.readFileSync(p, 'utf8');
}

function writeUtf8(p, content) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, 'utf8');
}

function copyDirRecursive(srcDir, destDir) {
  ensureDir(destDir);
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
      continue;
    }
    if (entry.isFile()) {
      ensureDir(path.dirname(destPath));
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function mapClaudeModelToOpenCode(model) {
  const m = String(model || '').trim().toLowerCase();

  // If the source is already OpenAI, keep it.
  if (m.startsWith('openai/')) return model;

  // If the source is an Anthropic model id, convert it to our default.
  if (m.startsWith('anthropic/') || m.includes('claude-')) return DEFAULT_MAIN_MODEL;

  // Default to OpenAI models so users without Anthropic access can run the generated config.
  // If you want different OpenAI models, tweak these mappings.
  if (m === 'opus') return DEFAULT_MAIN_MODEL;
  if (m === 'sonnet') return DEFAULT_MAIN_MODEL;
  if (m === 'haiku') return DEFAULT_FAST_MODEL;

  // If already fully qualified but not Anthropic/OpenAI, pass through.
  if (m.includes('/')) return model;

  // Final fallback.
  return DEFAULT_MAIN_MODEL;
}

function toYamlScalar(value) {
  const s = String(value ?? '').trim();
  // Quote only when needed.
  if (!s) return '""';
  if (/[:\n\r\t#]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function renderYamlFrontmatter(obj) {
  // Only supports a shallow object + optional nested objects (one level) for tools/permission.
  const lines = ['---'];
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        lines.push(`${key}: {}`);
        continue;
      }

      lines.push(`${key}:`);
      for (const [k2, v2] of entries) {
        lines.push(`  ${k2}: ${typeof v2 === 'boolean' ? String(v2) : toYamlScalar(v2)}`);
      }
      continue;
    }
    lines.push(`${key}: ${typeof value === 'boolean' ? String(value) : toYamlScalar(value)}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n\n';
}

function convertAgents() {
  if (!fs.existsSync(SRC_AGENTS_DIR)) return 0;
  ensureDir(OUT_AGENTS_DIR);

  const files = fs.readdirSync(SRC_AGENTS_DIR).filter((f) => f.endsWith('.md'));
  let count = 0;

  for (const file of files) {
    const srcPath = path.join(SRC_AGENTS_DIR, file);
    const src = readUtf8(srcPath);
    const { frontmatter, body } = splitFrontmatter(src);

    const agentName = file.replace(/\.md$/, '');
    const description = frontmatter?.description || `ECC agent: ${agentName}`;
    const model = mapClaudeModelToOpenCode(frontmatter?.model);

    const toolsList = Array.isArray(frontmatter?.tools) ? frontmatter.tools : [];
    const toolsLower = new Set(toolsList.map((t) => String(t).trim().toLowerCase()));

    // Only restrict high-impact tools. Leave everything else default-enabled.
    const tools = {};
    if (!toolsLower.has('write')) tools.write = false;
    if (!toolsLower.has('edit')) tools.edit = false;
    if (!toolsLower.has('bash')) tools.bash = false;

    const outFrontmatter = {
      description,
      mode: 'subagent',
      model,
      tools
    };

    const out = renderYamlFrontmatter(outFrontmatter) + body.trimStart();
    const outPath = path.join(OUT_AGENTS_DIR, `${agentName}.md`);
    writeUtf8(outPath, out);
    count++;
  }
  return count;
}

function inferCommandDescription(body, fallbackName) {
  const lines = body.split(/\r?\n/).map((l) => l.trim());
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('# ')) return line.slice(2).trim();
    return fallbackName;
  }
  return fallbackName;
}

function convertCommands() {
  if (!fs.existsSync(SRC_COMMANDS_DIR)) return 0;
  ensureDir(OUT_COMMANDS_DIR);

  const files = fs.readdirSync(SRC_COMMANDS_DIR).filter((f) => f.endsWith('.md'));
  let count = 0;

  const agentForCommand = {
    plan: 'planner',
    tdd: 'tdd-guide',
    'code-review': 'code-reviewer',
    'build-fix': 'build-error-resolver',
    e2e: 'e2e-runner',
    'refactor-clean': 'refactor-cleaner',
    'update-docs': 'doc-updater',
    'update-codemaps': 'doc-updater',
    'go-review': 'go-reviewer',
    'go-build': 'go-build-resolver',
    'python-review': 'python-reviewer',
    // These are more orchestration-ish; default to planner for now.
    orchestrate: 'planner',
    'multi-plan': 'planner'
  };

  for (const file of files) {
    const srcPath = path.join(SRC_COMMANDS_DIR, file);
    const src = readUtf8(srcPath);
    const { frontmatter, body } = splitFrontmatter(src);

    const cmdName = file.replace(/\.md$/, '');
    const description = frontmatter?.description || inferCommandDescription(body, cmdName);
    const agent = agentForCommand[cmdName];

    const outFrontmatter = {
      description,
      ...(agent ? { agent, subtask: true } : {})
    };

    const out = renderYamlFrontmatter(outFrontmatter) + body.trimStart();
    const outPath = path.join(OUT_COMMANDS_DIR, `${cmdName}.md`);
    writeUtf8(outPath, out);
    count++;
  }
  return count;
}

function convertSkills() {
  if (!fs.existsSync(SRC_SKILLS_DIR)) return 0;
  rmDirSafe(OUT_SKILLS_DIR);
  copyDirRecursive(SRC_SKILLS_DIR, OUT_SKILLS_DIR);

  // Count skill directories (one per name)
  const entries = fs.readdirSync(SRC_SKILLS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).length;
}

function convertRules() {
  if (!fs.existsSync(SRC_RULES_DIR)) return 0;
  rmDirSafe(OUT_RULES_DIR);
  copyDirRecursive(SRC_RULES_DIR, OUT_RULES_DIR);

  const entries = fs.readdirSync(SRC_RULES_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).length;
}

function readMcpServersConfig() {
  if (!fs.existsSync(SRC_MCP_CONFIG_PATH)) return {};
  try {
    const raw = readUtf8(SRC_MCP_CONFIG_PATH);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') return {};
    return parsed.mcpServers;
  } catch {
    return {};
  }
}

function convertMcpServersToOpenCodeConfig(mcpServers) {
  const out = {};
  for (const [name, server] of Object.entries(mcpServers || {})) {
    if (!server || typeof server !== 'object') continue;

    // Claude/Cursor MCP uses type:"http" for remote servers.
    const typeRaw = String(server.type || '').trim().toLowerCase();
    if (typeRaw === 'http') {
      if (typeof server.url !== 'string' || !server.url) continue;
      out[name] = {
        type: 'remote',
        url: server.url,
        enabled: false
      };
      continue;
    }

    // Local server: command + args
    if (typeof server.command === 'string' && Array.isArray(server.args)) {
      const env = (server.env && typeof server.env === 'object') ? server.env : null;

      const mapped = {
        type: 'local',
        command: [server.command, ...server.args],
        enabled: false
      };

      if (env) {
        const mappedEnv = {};
        for (const key of Object.keys(env)) {
          // Always source secrets from environment variables.
          mappedEnv[key] = `{env:${key}}`;
        }
        if (Object.keys(mappedEnv).length > 0) mapped.environment = mappedEnv;
      }

      out[name] = mapped;
      continue;
    }

    // If format doesn't match, skip silently.
  }
  return out;
}

function writeOpenCodeJson() {
  const mcpServers = readMcpServersConfig();
  const mcp = convertMcpServersToOpenCodeConfig(mcpServers);

  const config = {
    $schema: 'https://opencode.ai/config.json',
    model: DEFAULT_MAIN_MODEL,
    small_model: DEFAULT_FAST_MODEL,
    instructions: ['rules/**/*.md'],
    ...(Object.keys(mcp).length > 0 ? { mcp } : {})
  };

  writeUtf8(path.join(OUT_DIR, 'opencode.json'), JSON.stringify(config, null, 2) + '\n');
}

function main() {
  // Ensure we are running from within the repo (basic safety)
  const pkgJson = path.join(REPO_ROOT, 'package.json');
  if (!fs.existsSync(pkgJson)) {
    console.error('ERROR: package.json not found at repo root. Refusing to run.');
    process.exit(2);
  }

  rmDirSafe(OUT_DIR);
  ensureDir(OUT_DIR);

  const agentCount = convertAgents();
  const commandCount = convertCommands();
  const skillCount = convertSkills();
  const ruleDirCount = convertRules();

  writeOpenCodeJson();

  writeUtf8(
    path.join(OUT_DIR, 'GENERATED.md'),
    [
      '# Generated OpenCode Config',
      '',
      'This directory is generated from the Claude Code source-of-truth in this repo:',
      '- agents/*.md',
      '- commands/*.md',
      '- skills/**',
      '- rules/**',
      '- mcp-configs/mcp-servers.json (converted into opencode.json `mcp`)',
      '',
      'Regenerate with:',
      '  node scripts/opencode/convert.js',
      '',
      'To use with OpenCode as a portable config pack:',
      '  export OPENCODE_CONFIG_DIR="$PWD/.opencode"',
      '  export OPENCODE_CONFIG="$PWD/.opencode/opencode.json"',
      '  opencode',
      ''
    ].join('\n')
  );

  console.log(
    `Generated .opencode/: ${agentCount} agents, ${commandCount} commands, ${skillCount} skills, ${ruleDirCount} rule sets`
  );
}

main();
