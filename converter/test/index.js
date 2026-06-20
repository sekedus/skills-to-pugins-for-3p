/**
 * test/index.js — Lightweight validation test for the Skills → Plugins Converter.
 *
 * Replicates the core discovery & validation logic from script.js and runs
 * it against every zip in the companion test/ directory.
 *
 * Usage:
 *   node test/index.js <path-to-test-dir>
 *
 * Example:
 *   node test/index.js ../test
 *   node test/index.js C:/Users/warrior/Downloads/skill-creator/test
 *   npm test -- C:/Users/warrior/Downloads/skill-creator/test
 */

// ── Dependencies ────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const JSZip   = require('jszip');
const jsyaml  = require('js-yaml');

// ── Core validation helpers (mirror of script.js) ──────────────────────

function isValidSkillName(name) {
  if (!name || name.length > 64) return false;
  if (!/^[a-z0-9-]+$/.test(name)) return false;
  if (/^-/.test(name) || /-$/.test(name)) return false;
  if (/--/.test(name)) return false;
  return true;
}

function parseSkillMd(content) {
  const result = { frontmatter: null, body: '', error: null };
  if (content instanceof Uint8Array) {
    content = new TextDecoder().decode(content);
  }
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
  try {
    const fm = jsyaml.load(yamlStr);
    if (!fm || typeof fm !== 'object') {
      result.error = 'Frontmatter must be a YAML mapping';
      return result;
    }
    result.frontmatter = fm;
    result.body = trimmed.substring(endIdx + 3).trim();
  } catch (e) {
    result.error = 'YAML parsing error: ' + e.message;
  }
  return result;
}

function validateSkill(skillDirName, files) {
  const errors = [];
  const warnings = [];

  // Must have SKILL.md (case-insensitive)
  const skillMdPath = `${skillDirName}/SKILL.md`;
  let skillMdContent = files.get(skillMdPath);

  if (!skillMdContent) {
    for (const [p, content] of files) {
      const pLower = p.toLowerCase();
      const dirPrefix = skillDirName.toLowerCase() + '/';
      if (pLower.endsWith('/skill.md') && pLower.startsWith(dirPrefix)) {
        skillMdContent = content;
        break;
      }
    }
  }

  if (!skillMdContent) {
    errors.push('Missing SKILL.md — every skill needs one');
    return { valid: false, errors, warnings, name: skillDirName, description: '', license: '', metadata: null, compatibility: '' };
  }

  const parsed = parseSkillMd(skillMdContent);
  if (parsed.error) {
    errors.push('Invalid SKILL.md: ' + parsed.error);
    return { valid: false, errors, warnings, name: skillDirName, description: '', license: '', metadata: null, compatibility: '', body: '' };
  }

  const fm = parsed.frontmatter;

  if (!fm.name) {
    errors.push('Frontmatter must have a "name" field');
  } else if (typeof fm.name !== 'string') {
    errors.push('Frontmatter "name" must be a string');
  } else if (!isValidSkillName(fm.name)) {
    errors.push(`Invalid name "${fm.name}": lowercase, hyphens, no leading/trailing hyphen, no consecutive hyphens, max 64 chars`);
  } else if (fm.name !== skillDirName) {
    errors.push(`Name "${fm.name}" does not match directory name "${skillDirName}"`);
  }

  if (!fm.description) {
    errors.push('Frontmatter must have a "description" field');
  } else if (typeof fm.description !== 'string') {
    errors.push('Frontmatter "description" must be a string');
  } else if (fm.description.length > 1024) {
    warnings.push('Description exceeds 1024 characters (AI agents may truncate)');
  }

  if (fm.license && typeof fm.license !== 'string') {
    warnings.push('"license" should be a string');
  }
  if (fm.compatibility) {
    if (typeof fm.compatibility !== 'string') {
      warnings.push('"compatibility" should be a string');
    } else if (fm.compatibility.length > 500) {
      warnings.push('"compatibility" exceeds 500 characters');
    }
  }
  if (fm.metadata && typeof fm.metadata !== 'object') {
    warnings.push('"metadata" should be a key-value mapping');
  }
  if (fm['allowed-tools'] && typeof fm['allowed-tools'] !== 'string') {
    warnings.push('"allowed-tools" should be a space-separated string');
  }

  return { valid: errors.length === 0, errors, warnings, name: fm.name || skillDirName, description: fm.description || '', license: fm.license || '', metadata: fm.metadata || null, compatibility: fm.compatibility || '' };
}

// ── Full pipeline: discover + validate a zip ───────────────────────────

async function analyzeZip(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(buffer);

  // Build file map (path → Uint8Array content)
  const files = new Map();
  const entries = new Map(); // keep raw entries for async reads
  zip.forEach((relativePath, entry) => {
    if (!entry.dir) {
      entries.set(relativePath, entry);
    }
  });

  // Resolve all file contents upfront
  for (const [p, entry] of entries) {
    const content = await entry.async('uint8array');
    files.set(p, content);
  }

  // Step 1: Discover directories with SKILL.md (case-insensitive)
  const skillDirs = new Set();
  for (const [p] of files) {
    const parts = p.split('/');
    const last = parts[parts.length - 1];
    if (parts.length >= 2 && last.toLowerCase() === 'skill.md') {
      skillDirs.add(parts[0]);
    } else if (parts.length === 1 && last.toLowerCase() === 'skill.md') {
      skillDirs.add('');
    }
  }

  // Also discover dirs without SKILL.md when there are 2+ proper skill dirs
  const properSkillCount = [...skillDirs].filter(sd => sd !== '').length;
  if (properSkillCount >= 2) {
    for (const [p] of files) {
      const parts = p.split('/');
      if (parts.length >= 2) {
        const dirName = parts[0];
        if (!skillDirs.has(dirName)) {
          skillDirs.add(dirName);
        }
      }
    }
  }

  // Step 2: Validate each skill
  const results = [];
  for (const dirName of skillDirs) {
    const skillFiles = new Map();
    if (dirName === '') {
      // Root entry: collect files not inside any other skill dir
      const otherDirs = new Set(skillDirs);
      otherDirs.delete('');
      for (const [p, entry] of files) {
        let claimed = false;
        for (const sd of otherDirs) {
          if (p.startsWith(sd + '/')) { claimed = true; break; }
        }
        if (!claimed) {
          skillFiles.set(p, entry);
        }
      }
    } else {
      for (const [p, entry] of files) {
        if (p.startsWith(dirName + '/') || p === dirName) {
          skillFiles.set(p, entry);
        }
      }
    }

    let validation;
    if (dirName === '') {
      const allFiles = [...skillFiles.keys()].filter(f => !f.endsWith('/')).sort();
      const rootLevel = allFiles.filter(f => !f.includes('/'));
      const skillMdFile = rootLevel.find(f => f.toLowerCase() === 'skill.md');
      const hasSkillMd = !!skillMdFile;

      if (hasSkillMd) {
        const parsed = parseSkillMd(skillFiles.get(skillMdFile));
        const skillName = parsed.frontmatter?.name || 'unknown';
        validation = {
          valid: false,
          errors: [`All skill files must be inside a skill directory (e.g. "${skillName}/"). SKILL.md is at zip root.`],
          warnings: [],
          name: skillName,
          description: parsed.frontmatter?.description || '',
          license: parsed.frontmatter?.license || '',
          metadata: parsed.frontmatter?.metadata || null,
          compatibility: parsed.frontmatter?.compatibility || '',
          body: parsed.body || ''
        };
      } else {
        validation = {
          valid: false,
          errors: [`No SKILL.md found. A skill must be a directory containing SKILL.md.`],
          warnings: [],
          name: 'unknown',
          description: '', license: '', metadata: null, compatibility: '', body: ''
        };
      }
    } else {
      validation = validateSkill(dirName, skillFiles);
    }

    results.push({ dirName, validation, fileCount: skillFiles.size });
  }

  // Check for orphan files — invalidate any valid skill if orphans exist
  const hasRootEntry = skillDirs.has('');
  const hasValidDirs = [...skillDirs].some(sd => sd !== '');
  if (hasValidDirs && !hasRootEntry) {
    const orphanPaths = [];
    for (const [p] of files) {
      let inside = false;
      for (const sd of skillDirs) {
        if (sd === '') continue;
        if (p.startsWith(sd + '/')) { inside = true; break; }
      }
      if (!inside) orphanPaths.push(p);
    }
    if (orphanPaths.length > 0) {
      // Invalidate each previously valid skill (mirrors the converter logic)
      for (const r of results) {
        if (r.validation.valid) {
          r.validation.valid = false;
          r.validation.errors.push(`Stray files found outside skill directory`);
        }
      }
    }
  } else if (!hasValidDirs && !hasRootEntry) {
    // No skills at all — create a synthetic "No SKILL.md found" entry
    results.push({
      dirName: '–',
      validation: {
        valid: false,
        errors: ['No SKILL.md found. A skill must be a directory containing SKILL.md.'],
        warnings: [], name: 'unknown', description: '', license: '', metadata: null, compatibility: '', body: ''
      },
      fileCount: [...files.keys()].filter(f => !f.endsWith('/')).length
    });
  }

  return {
    filename: path.basename(zipPath),
    skillCount: results.length,
    validCount: results.filter(r => r.validation.valid).length,
    invalidCount: results.filter(r => !r.validation.valid).length,
    details: results.map(r => ({
      dir: r.dirName,
      valid: r.validation.valid,
      errors: r.validation.errors,
      fileCount: r.fileCount
    }))
  };
}

// ── Expected results ────────────────────────────────────────────────────

const EXPECTED = {
  'skill-creator.zip':                     { total: 1, valid: 1, invalid: 0, validNames: ['skill-creator'] },
  'anthropics-skills.zip':                 { total: 17, valid: 17, invalid: 0 },
  'anthropics-skills.mix.zip':             { total: 17, valid: 14, invalid: 3, invalidNames: ['pdf', 'pptx2', 'xlsx'] },
  'skill-creator.diff-name-dir.zip':       { total: 1, valid: 0, invalid: 1, errContains: 'does not match directory' },
  'skill-creator.diff-name-skill.zip':     { total: 1, valid: 0, invalid: 1, errContains: 'does not match directory' },
  'skill-creator.no-dir.no-skill-md.zip':  { total: 1, valid: 0, invalid: 1, errContains: 'No SKILL.md found' },
  'skill-creator.no-dir.zip':              { total: 1, valid: 0, invalid: 1, errContains: 'SKILL.md is at zip root' },
  'skill-creator.no-skill-md.zip':         { total: 1, valid: 0, invalid: 1, errContains: 'No SKILL.md found' },
  'skill-creator.others-outside.zip':      { total: 1, valid: 0, invalid: 1, errContains: 'Stray files' },
  'skill-creator.skill-md-outside.zip':    { total: 1, valid: 0, invalid: 1, errContains: 'SKILL.md is at zip root' },
};

// ── Runner ──────────────────────────────────────────────────────────────

async function main() {
  const testDir = process.argv[2];
  if (!testDir) {
    console.error('Usage: node test/index.js <path-to-test-dir>');
    process.exit(1);
  }
  if (!fs.existsSync(testDir)) {
    console.error(`Test directory not found: ${testDir}`);
    process.exit(1);
  }

  const zipFiles = fs.readdirSync(testDir)
    .filter(f => f.endsWith('.zip'))
    .sort();
  console.log(`Testing ${zipFiles.length} zip files in ${testDir}\n`);

  let passed = 0;
  let failed = 0;

  for (const zf of zipFiles) {
    const zipPath = path.join(testDir, zf);
    const exp = EXPECTED[zf];
    if (!exp) {
      console.log(`  ⚠  ${zf}  (no expected result configured, skipping)`);
      continue;
    }

    const result = await analyzeZip(zipPath);
    const ok = checkResult(result, exp);

    if (ok) {
      console.log(`  ✅ ${zf}`);
      passed++;
    } else {
      console.log(`  ❌ ${zf}`);
      console.log(`      Expected: total=${exp.total}, valid=${exp.valid}, invalid=${exp.invalid}`);
      console.log(`      Got:      total=${result.skillCount}, valid=${result.validCount}, invalid=${result.invalidCount}`);
      for (const d of result.details) {
        const status = d.valid ? '✓' : '✗';
        console.log(`        ${status} ${d.dir}: ${d.errors.length ? d.errors.join('; ') : 'ok'}  (${d.fileCount} files)`);
      }
      failed++;
    }
  }

  console.log(`\n\u2500'.repeat(50)}`);
  console.log(`Result: ${passed + failed}/${zipFiles.length} passed  ${failed === 0 ? ' ✅ all passed' : ' ❌ some failed'}`);
  process.exit(failed > 0 ? 1 : 0);
}

function checkResult(result, exp) {
  if (result.skillCount !== exp.total) return false;
  if (result.validCount !== exp.valid) return false;
  if (result.invalidCount !== exp.invalid) return false;

  // Check valid names if specified
  if (exp.validNames) {
    const validDirs = result.details.filter(d => d.valid).map(d => d.dir);
    for (const vn of exp.validNames) {
      if (!validDirs.includes(vn)) return false;
    }
  }

  // Check invalid names if specified
  if (exp.invalidNames) {
    const invalidDirs = result.details.filter(d => !d.valid).map(d => d.dir);
    for (const invn of exp.invalidNames) {
      if (!invalidDirs.includes(invn)) return false;
    }
  }

  // Check that at least one error message contains the expected substring
  if (exp.errContains !== undefined) {
    // If errContains is set, we expect at least one invalid skill with that text
    const allErrors = result.details.filter(d => !d.valid).flatMap(d => d.errors);
    const found = allErrors.some(e => e.includes(exp.errContains));
    if (!found) return false;
  }

  return true;
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
