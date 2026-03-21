#!/usr/bin/env node
// Sync discovered skills to Telegram BotFather command menu.
// Called by SessionStart hook. Injects companion instructions to stdout, syncs commands. Exit 0 always.

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const TELEGRAM_DIR = path.join(CLAUDE_DIR, 'channels', 'telegram');
const CACHE_DIR = path.join(CLAUDE_DIR, 'plugins', 'cache');
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');

// --- Helpers ---

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/TELEGRAM_BOT_TOKEN=(.+)/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// Parse YAML frontmatter from SKILL.md (simple parser, no deps)
function parseFrontmatter(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const fm = fmMatch[1];
    // Extract name
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    // Extract description (handles inline, >-, >, |-, and | YAML scalars)
    let description = '';
    // Try block scalar first (>-, >, |-, |)
    const descBlockMatch = fm.match(/^description:\s*[>|]-?\s*\n([\s\S]*?)(?=\n[^\s]|\n?$)/m);
    if (descBlockMatch) {
      description = descBlockMatch[1]
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .join(' ');
    } else {
      // Inline value
      const descInlineMatch = fm.match(/^description:\s*(.+)$/m);
      if (descInlineMatch) {
        description = descInlineMatch[1].trim().replace(/^["']|["']$/g, '');
      }
    }
    return nameMatch ? { name: nameMatch[1].trim(), description } : null;
  } catch {
    return null;
  }
}

// List subdirectories of a path
function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}

// Get the latest version directory (sorts by name, picks last)
function latestVersionDir(pluginCacheDir) {
  const versions = subdirs(pluginCacheDir);
  if (versions.length === 0) return null;
  versions.sort();
  return path.join(pluginCacheDir, versions[versions.length - 1]);
}

// Derive origin label from plugin name: first segment before hyphen
function deriveOrigin(pluginName) {
  return pluginName.split('-')[0];
}

// Sanitize a skill name into a Telegram command: lowercase, replace non-alphanumeric with _, truncate to 32
function sanitizeCommand(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);
}

// --- Skill Discovery ---

function discoverSkills() {
  const settings = readJSON(path.join(CLAUDE_DIR, 'settings.json'));
  if (!settings) return [];

  const enabledPlugins = settings.enabledPlugins || {};
  const extraMarketplaces = settings.extraKnownMarketplaces || {};
  const skills = []; // { id, name, description, origin, source, pluginKey }

  // 1. Discover plugin skills
  for (const [key, enabled] of Object.entries(enabledPlugins)) {
    if (!enabled) continue;
    const atIdx = key.lastIndexOf('@');
    if (atIdx < 1) continue;
    const pluginName = key.slice(0, atIdx);
    const marketplace = key.slice(atIdx + 1);

    // Determine if this is a directory-source marketplace
    const mktConfig = extraMarketplaces[marketplace];
    const isDirectory = mktConfig?.source?.source === 'directory';
    const dirPath = mktConfig?.source?.path;

    let skillFiles = [];

    if (isDirectory && dirPath) {
      // Scan <dirPath>/<pluginName>/skills/*/SKILL.md
      const skillsBase = path.join(dirPath, pluginName, 'skills');
      for (const skillDir of subdirs(skillsBase)) {
        skillFiles.push(path.join(skillsBase, skillDir, 'SKILL.md'));
      }
    }

    // Also scan cache (fallback for directory sources, primary for others)
    if (skillFiles.length === 0) {
      const pluginCacheDir = path.join(CACHE_DIR, marketplace, pluginName);
      const versionDir = latestVersionDir(pluginCacheDir);
      if (versionDir) {
        const skillsBase = path.join(versionDir, 'skills');
        for (const skillDir of subdirs(skillsBase)) {
          skillFiles.push(path.join(skillsBase, skillDir, 'SKILL.md'));
        }
      }
    }

    const origin = deriveOrigin(pluginName);
    const usePrefix = !isDirectory;

    for (const f of skillFiles) {
      const fm = parseFrontmatter(f);
      if (!fm) continue;
      const id = usePrefix ? `${pluginName}:${fm.name}` : fm.name;
      skills.push({
        id,
        name: fm.name,
        description: fm.description,
        origin,
        source: 'plugin',
        pluginKey: key
      });
    }
  }

  // 2. Discover user skills from ~/.claude/skills/*/SKILL.md
  for (const skillDir of subdirs(SKILLS_DIR)) {
    const f = path.join(SKILLS_DIR, skillDir, 'SKILL.md');
    const fm = parseFrontmatter(f);
    if (!fm) continue;
    skills.push({
      id: fm.name,
      name: fm.name,
      description: fm.description,
      origin: 'user',
      source: 'user',
      pluginKey: null
    });
  }

  // 3. Discover project-level skills from <cwd>/.claude/skills/*/SKILL.md
  const projectSkillsDir = path.join(process.cwd(), '.claude', 'skills');
  for (const skillDir of subdirs(projectSkillsDir)) {
    const f = path.join(projectSkillsDir, skillDir, 'SKILL.md');
    const fm = parseFrontmatter(f);
    if (!fm) continue;
    // Skip if already discovered as user skill
    if (skills.some(s => s.id === fm.name)) continue;
    skills.push({
      id: fm.name,
      name: fm.name,
      description: fm.description,
      origin: 'project',
      source: 'project',
      pluginKey: null
    });
  }

  // 4. Discover project-level commands from <cwd>/.claude/commands/<namespace>/<cmd>.md
  const projectCmdsDir = path.join(process.cwd(), '.claude', 'commands');
  for (const ns of subdirs(projectCmdsDir)) {
    const nsDir = path.join(projectCmdsDir, ns);
    try {
      const files = fs.readdirSync(nsDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const cmdName = path.basename(file, '.md');
        const id = `${ns}:${cmdName}`;
        skills.push({
          id,
          name: cmdName,
          description: '',
          origin: ns,
          source: 'command',
          pluginKey: null
        });
      }
    } catch {}
  }

  return skills;
}

// --- Filter, Map, and Build Command List ---

// Project-scoped sources that auto-include by default.
const PROJECT_SOURCES = new Set(['project', 'command']);

// Look up a skill in a map by prefixed id or bare name.
function configLookup(map, skill) {
  if (skill.id in map) return skill.id;
  if (skill.name !== skill.id && skill.name in map) return skill.name;
  return null;
}

function configHas(set, skill) {
  return set.has(skill.id) || (skill.name !== skill.id && set.has(skill.name));
}

function buildCommands(skills, config) {
  // Support both v2 (commands.*) and v1 (flat) schema
  const cmds = config.commands || {};
  const exclude = cmds.exclude || {};
  const excludePlugins = new Set(exclude.plugins || []);
  const excludeProject = new Set(exclude.skills || []);
  const include = cmds.aliases || {};
  const extra = cmds.extra || [];
  const seen = new Set();
  const commands = [];

  for (const skill of skills) {
    // 1. Plugin excluded? -> skip
    if (skill.pluginKey && excludePlugins.has(skill.pluginKey)) continue;

    // 2. Has include entry? -> use its command/description (global whitelist or project override)
    const includeKey = configLookup(include, skill);
    if (includeKey !== null) {
      const entry = include[includeKey];
      const cmd = entry.command;
      if (seen.has(cmd)) continue;
      seen.add(cmd);
      commands.push({
        command: cmd,
        description: (entry.description || '').slice(0, 256)
      });
      continue;
    }

    // 3. Project-scoped and not excluded? -> auto-derive
    if (PROJECT_SOURCES.has(skill.source)) {
      if (configHas(excludeProject, skill)) continue;
      const cmd = sanitizeCommand(skill.id);
      if (seen.has(cmd)) continue;
      seen.add(cmd);
      const desc = skill.description
        ? `[${skill.origin}] ${skill.description}`
        : `[${skill.origin}] ${skill.name}`;
      commands.push({
        command: cmd,
        description: desc.slice(0, 256)
      });
      continue;
    }

    // 4. Global skill without include entry -> skip
  }

  // Append extra commands
  for (const entry of extra) {
    if (seen.has(entry.command)) continue;
    seen.add(entry.command);
    commands.push({
      command: entry.command,
      description: (entry.description || '').slice(0, 256)
    });
  }

  return commands;
}

// --- Telegram API ---

function setMyCommands(token, commands) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      commands,
      scope: { type: 'all_private_chats' }
    });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/setMyCommands`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 4000
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.ok) resolve(parsed);
          else reject(new Error(`Telegram API error: ${parsed.description}`));
        } catch (e) {
          reject(new Error(`Bad response: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

// --- Main ---

async function main() {
  // 1. Read token
  const token = readEnv(path.join(TELEGRAM_DIR, '.env'));
  if (!token) {
    process.stderr.write('telegram-sync-commands: no bot token found\n');
    return;
  }

  // Inject companion instructions (Claude Code surfaces SessionStart stdout as <system-reminder>)
  process.stdout.write([
    '[telegram-companion] When handling Telegram messages:',
    '1. FIRST call react with emoji \u{1F440} on the incoming message (enables progress tracking).',
    '2. Use reply with format: "markdownv2" for responses. Escape _ * [ ] ( ) ~ > # + - = | { } . ! outside code blocks.',
    '3. Voice/audio messages (attachment_kind: voice/audio) have attachment_file_id. Use the transcribe skill.',
  ].join('\n') + '\n');

  // 2. Read config (optional; use defaults if missing)
  const config = readJSON(path.join(TELEGRAM_DIR, 'command-config.json')) || {
    commands: { exclude: { plugins: [], skills: [] }, aliases: {}, extra: [] },
    progress: { statusUpdates: true }
  };

  // 3. Discover skills
  const skills = discoverSkills();

  // 4. Build command list
  const commands = buildCommands(skills, config);

  // 5. Sync to Telegram
  await setMyCommands(token, commands);
}

main().catch(err => {
  process.stderr.write(`telegram-sync-commands: ${err.message}\n`);
}).finally(() => {
  process.exit(0);
});
