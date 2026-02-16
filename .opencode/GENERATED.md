# Generated OpenCode Config

This directory is generated from the Claude Code source-of-truth in this repo:
- agents/*.md
- commands/*.md
- skills/**
- rules/**
- mcp-configs/mcp-servers.json (converted into opencode.json `mcp`)

Regenerate with:
  node scripts/opencode/convert.js

To use with OpenCode as a portable config pack:
  export OPENCODE_CONFIG_DIR="$PWD/.opencode"
  export OPENCODE_CONFIG="$PWD/.opencode/opencode.json"
  opencode
