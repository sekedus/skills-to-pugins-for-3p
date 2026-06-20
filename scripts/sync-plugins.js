#!/usr/bin/env node

/**
 * Skills → Plugins Sync Script
 *
 * Fetches skills from upstream repositories, converts them to Claude Desktop
 * 3P plugin structure, and saves them to the output directory.
 *
 * Usage:
 *   node sync-plugins.js              # Normal sync
 *   node sync-plugins.js --force      # Re-convert everything even if unchanged
 *   node sync-plugins.js --dry-run    # Show what would change without writing
 *   node sync-plugins.js --config ./my-config.json  # Custom config path
 *
 * Designed to run both locally and in GitHub Actions (see ../.github/workflows/sync-plugins.yml).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Configuration ──────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, 'sync-config.json');
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT_DIR, 'plugins');
const DEFAULT_TEMP_DIR = path.join(ROOT_DIR, '.tmp-sync');

// Parse CLI args
const args = process.argv.slice(2);
const FLAG_FORCE = args.includes('--force') || process.env.FORCE === 'true';
const FLAG_DRY_RUN = args.includes('--dry-run');
const customConfig = args.find(a => a.startsWith('--config='));
const configPath = customConfig ? customConfig.split('=')[1] : CONFIG_PATH;

// ── Utilities ──────────────────────────────────────────────────────────

function log(msg, type = 'info') {
  const prefix = type === 'error' ? '❌' : type === 'warn' ? '⚠️' : type === 'success' ? '✅' : '➡️';
  const ts = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
  console.log(`${ts} ${prefix} ${msg}`);
}

function run(cmd, opts = {}) {
  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      stdio: opts.silent ? 'pipe' : 'pipe',
      ...opts
    });
    return { code: 0, stdout: output?.trim() || '', stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout?.toString().trim() || '',
      stderr: err.stderr?.toString().trim() || ''
    };
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      // Skip .git directories inside cloned repos
      if (entry.name === '.git') continue;
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      // Ensure parent directory exists (handles deeply nested paths)
      ensureDir(path.dirname(destPath));
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (err) {
        // If copy fails, log but don't crash — skill may have broken symlinks
        log(`Failed to copy ${srcPath}: ${err.message}`, 'warn');
      }
    }
  }
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath);
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash) + content[i];
    hash |= 0;
  }
  return hash.toString(36);
}

/**
 * Simple YAML frontmatter parser (no dependencies).
 */
function parseFrontmatter(content) {
  const result = { frontmatter: null, body: '', error: null };

  const trimmed = content.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---')) {
    result.error = 'SKILL.md must start with YAML frontmatter (---)';
    return result;
  }
  const endIdx = trimmed.indexOf('---', 3);
  if (endIdx === -1) {
    result.error = 'Unclosed YAML frontmatter (no closing ---)';
    return result;
  }

  const yamlStr = trimmed.substring(3, endIdx).trim();
  const body = trimmed.substring(endIdx + 3).trim();

  // Minimal YAML parser for the subset used by Agent Skills
  try {
    const fm = parseSimpleYaml(yamlStr);
    result.frontmatter = fm;
    result.body = body;
  } catch (e) {
    result.error = 'Frontmatter parsing error: ' + e.message;
  }
  return result;
}

/**
 * Parse a simple YAML mapping (supports strings, nested mappings, and lists).
 * This is intentionally basic — covers the Agent Skills spec fields.
 */
function parseSimpleYaml(yamlStr) {
  const result = {};
  const lines = yamlStr.split('\n');
  let currentKey = null;
  let currentIndent = 0;
  let nestedObj = null;
  let nestedKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check for top-level key: value
    const topMatch = trimmed.match(/^(\S[\w-]*)\s*:\s*(.*)$/);
    if (topMatch && !line.startsWith(' ')) {
      currentKey = topMatch[1];
      const val = topMatch[2].trim();
      if (val === '' || val === '|' || val === '>') {
        // Block scalar (| or >) — collect indented lines as literal text
        if ((val === '|' || val === '>') && i + 1 < lines.length && lines[i + 1].startsWith(' ')) {
          const blockIndent = lines[i + 1].search(/\S/);
          const blockLines = [];
          let j = i + 1;
          while (j < lines.length && lines[j].startsWith(' '.repeat(blockIndent))) {
            blockLines.push(lines[j].substring(blockIndent));
            j++;
          }
          result[currentKey] = val === '|' ? blockLines.join('\n') : blockLines.join(' ');
          i = j - 1;
          currentKey = null;
          continue;
        }
        // Empty value — could lead to nested mapping
        if (val === '' && i + 1 < lines.length && lines[i + 1].startsWith(' ')) {
          // Might be a nested mapping
          result[currentKey] = null; // placeholder
          currentIndent = 0;
          nestedObj = null;
        } else {
          result[currentKey] = '';
        }
      } else {
        // Remove quotes
        result[currentKey] = val.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
        currentKey = null;
      }
      continue;
    }

    // Nested mapping (indented)
    if (currentKey && line.startsWith('  ')) {
      const indent = line.search(/\S/);
      const nestedMatch = trimmed.match(/^(\S[\w-]*)\s*:\s*(.*)$/);
      if (nestedMatch) {
        const nk = nestedMatch[1];
        const nv = nestedMatch[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

        if (!result[currentKey] || typeof result[currentKey] !== 'object') {
          result[currentKey] = {};
        }
        result[currentKey][nk] = nv || null;
        nestedKey = nk;
      } else if (trimmed.startsWith('- ')) {
        // List item
        const listVal = trimmed.substring(2).trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
        if (!result[currentKey] || !Array.isArray(result[currentKey])) {
          result[currentKey] = [];
        }
        result[currentKey].push(listVal);
      }
      continue;
    }
  }

  // Post-process known fields
  if (result['allowed-tools']) {
    result['allowed-tools'] = String(result['allowed-tools']);
  }
  if (result.description) {
    result.description = String(result.description);
  }

  return result;
}

/**
 * Validate skill name per Agent Skills spec.
 */
function isValidSkillName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length > 64) return false;
  if (!/^[a-z0-9-]+$/.test(name)) return false;
  if (/^-/.test(name) || /-$/.test(name)) return false;
  if (/--/.test(name)) return false;
  return true;
}

/**
 * Validate a skill directory and return metadata.
 */
function validateSkill(skillDir) {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    return { valid: false, errors: ['Missing SKILL.md'], warnings: [] };
  }

  const content = fs.readFileSync(skillMdPath, 'utf-8');
  const parsed = parseFrontmatter(content);
  if (parsed.error) {
    return { valid: false, errors: [parsed.error], warnings: [] };
  }

  const fm = parsed.frontmatter;
  const errors = [];
  const warnings = [];
  const dirName = path.basename(skillDir);

  // Validate name
  if (!fm.name) {
    errors.push('Frontmatter missing required "name" field');
  } else if (!isValidSkillName(fm.name)) {
    errors.push(`Invalid name "${fm.name}": must be lowercase alphanumeric + hyphens, no leading/trailing hyphens, max 64 chars`);
  } else if (fm.name !== dirName) {
    warnings.push(`Name "${fm.name}" != directory "${dirName}" — using directory name`);
  }

  // Validate description
  if (!fm.description) {
    errors.push('Frontmatter missing required "description" field');
  } else if (typeof fm.description !== 'string') {
    errors.push('"description" must be a string');
  } else if (fm.description.length > 1024) {
    warnings.push('Description exceeds 1024 characters');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    name: fm.name || dirName,
    description: fm.description || '',
    license: fm.license || '',
    metadata: fm.metadata || null,
    compatibility: fm.compatibility || '',
    frontmatter: fm,
    body: parsed.body
  };
}

/**
 * Generate plugin manifest from skill metadata.
 * Falls back to sourceAuthor (from config source) if SKILL.md frontmatter
 * doesn't specify metadata.author.
 */
function generatePluginJson(skillName, validation, sourceAuthor) {
  const authorName = validation.metadata?.author || sourceAuthor || 'unknown';
  const manifest = {
    id: skillName,
    name: skillName,
    description: validation.description || '',
    author: { name: authorName }
  };
  return JSON.stringify(manifest, null, 2) + '\n';
}

/**
 * Convert a skill directory to a plugin directory in the output.
 */
function convertToPlugin(skillDir, outputBase, validation, sourceAuthor) {
  const dirName = path.basename(skillDir);
  const skillName = dirName; // Use directory name as plugin name
  const pluginDir = path.join(outputBase, skillName);

  ensureDir(pluginDir);

  // .claude-plugin/plugin.json
  const pluginDir2 = path.join(pluginDir, '.claude-plugin');
  ensureDir(pluginDir2);
  fs.writeFileSync(
    path.join(pluginDir2, 'plugin.json'),
    generatePluginJson(skillName, validation, sourceAuthor),
    'utf-8'
  );

  // skills/<skillName>/ — copy all original files
  const skillsTarget = path.join(pluginDir, 'skills', skillName);
  ensureDir(skillsTarget);
  copyDir(skillDir, skillsTarget);

  return pluginDir;
}

/**
 * Get the hash of a plugin directory (for change detection).
 */
function getPluginHash(pluginDir) {
  if (!fs.existsSync(pluginDir)) return '';
  const files = [];
  collectFiles(pluginDir, files);
  let combined = '';
  for (const f of files.sort()) {
    const relPath = path.relative(pluginDir, f);
    const h = hashFile(f);
    combined += `${relPath}:${h}\n`;
  }
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash) + combined.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

function collectFiles(dir, result) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, result);
    } else if (entry.isFile()) {
      result.push(fullPath);
    }
  }
}

// ── Main Sync Logic ────────────────────────────────────────────────────

async function sync() {
  log('Starting Skills → Plugins sync');
  log(`Config: ${configPath}`);
  log(`Output: ${DEFAULT_OUTPUT_DIR}`);
  if (FLAG_DRY_RUN) log('DRY RUN — no files will be written', 'warn');
  if (FLAG_FORCE) log('Force mode — will re-convert all skills', 'warn');

  // Read config
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    log(`Failed to read config: ${err.message}`, 'error');
    process.exit(1);
  }

  const outputDir = path.resolve(__dirname, config.outputDir || DEFAULT_OUTPUT_DIR);
  const tempDir = path.resolve(__dirname, config.tempDir || DEFAULT_TEMP_DIR);

  ensureDir(outputDir);
  ensureDir(tempDir);

  let totalConverted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const changes = [];

  for (const source of config.sources) {
    const repoUrl = `https://github.com/${source.author}/${source.repo}.git`;
    const repoDir = path.join(tempDir, `${source.author}-${source.repo}`);
    const branch = source.branch || 'main';

    log(`Processing source: ${source.author}/${source.repo} (${branch})`);

    // Clone or fetch
    if (fs.existsSync(repoDir)) {
      log(`Fetching latest from ${source.author}/${source.repo}...`);
      run(`git -C "${repoDir}" fetch origin`, { silent: true });
      run(`git -C "${repoDir}" checkout ${branch}`, { silent: true });
      run(`git -C "${repoDir}" reset --hard origin/${branch}`, { silent: true });
    } else {
      log(`Cloning ${repoUrl}...`);
      const clone = run(`git clone --depth 1 --branch ${branch} "${repoUrl}" "${repoDir}"`, { silent: true });
      if (clone.code !== 0) {
        log(`Failed to clone ${repoUrl}: ${clone.stderr}`, 'error');
        totalErrors++;
        continue;
      }
    }

    // Get last commit info for this repo
    const lastCommit = run(`git -C "${repoDir}" log -1 --format="%H %ai"`, { silent: true });
    log(`Latest commit: ${lastCommit.stdout || 'unknown'}`);

    // Process each skills directory
    for (const skillGroup of source.skills) {
      const skillsBaseDir = path.join(repoDir, skillGroup.directory);

      if (!fs.existsSync(skillsBaseDir)) {
        log(`Directory "${skillGroup.directory}" not found in ${source.author}/${source.repo}`, 'warn');
        continue;
      }

      const expectedSkills = skillGroup.names || [];
      const availableDirs = fs.readdirSync(skillsBaseDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const skillName of expectedSkills) {
        if (!availableDirs.includes(skillName)) {
          log(`Skill "${skillName}" not found in ${skillGroup.directory}`, 'warn');
          totalSkipped++;
          continue;
        }

        const skillDir = path.join(skillsBaseDir, skillName);
        const pluginDir = path.join(outputDir, skillName);

        // Validate
        const validation = validateSkill(skillDir);
        if (!validation.valid) {
          log(`Skill "${skillName}" validation failed: ${validation.errors.join('; ')}`, 'error');
          totalErrors++;
          continue;
        }

        // Check if already up-to-date (unless --force)
        const currentHash = getPluginHash(pluginDir);
        const tempPluginDir = path.join(tempDir, `__check__${skillName}`);
        removeDir(tempPluginDir);
        ensureDir(tempPluginDir);
        convertToPlugin(skillDir, tempPluginDir, validation, source.author);
        // hash the actual plugin dir inside temp (convertToPlugin creates subdir with skillName)
        const newHash = getPluginHash(path.join(tempPluginDir, skillName));
        removeDir(tempPluginDir);

        if (!FLAG_FORCE && currentHash === newHash && currentHash !== '') {
          log(`Skill "${skillName}" — unchanged, skipped`);
          totalSkipped++;
          continue;
        }

        // Convert and write
        if (FLAG_DRY_RUN) {
          log(`Skill "${skillName}" — would convert (dry run)`);
          totalConverted++;
          changes.push(skillName);
          continue;
        }

        // Remove existing, write new
        removeDir(pluginDir);
        convertToPlugin(skillDir, outputDir, validation, source.author);
        log(`Skill "${skillName}" — converted and saved ✅`, 'success');
        totalConverted++;
        changes.push(skillName);
      }
    }
  }

  // Cleanup temp
  if (!FLAG_DRY_RUN) {
    removeDir(tempDir);
  }

  // Summary
  log('─'.repeat(50));
  log(`Sync complete:`, 'success');
  log(`  Converted/updated: ${totalConverted}`);
  log(`  Skipped (unchanged): ${totalSkipped}`);
  log(`  Errors: ${totalErrors}`);

  if (changes.length > 0) {
    log(`  Changed plugins: ${changes.join(', ')}`);
  }

  // Output for GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    const hasChanges = changes.length > 0;
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_changes=${hasChanges}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed_count=${totalConverted}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed_plugins=${changes.join(',')}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `error_count=${totalErrors}\n`);
  }

  return { totalConverted, totalSkipped, totalErrors, changes };
}

// ── Run ────────────────────────────────────────────────────────────────

sync()
  .then(result => {
    if (result.totalErrors > 0) {
      log('Sync completed with errors', 'warn');
      process.exit(0); // Don't fail the workflow for individual skill errors
    }
    if (result.totalConverted === 0) {
      log('Nothing to update — all skills are current', 'info');
    }
  })
  .catch(err => {
    log(`Fatal error: ${err.message}`, 'error');
    console.error(err);
    process.exit(1);
  });
