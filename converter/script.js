// Logging 
const logEl = document.getElementById('log');
function log(msg, type = 'info') {
  document.getElementById('logCard').classList.remove('no_items');
  const line = document.createElement('div');
  line.className = `line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  logEl.classList.add('visible');
}

function clearLog() {
  logEl.innerHTML = '';
  logEl.classList.remove('visible');
  document.getElementById('logCard').classList.add('no_items');
}
document.getElementById('clearLogBtn').addEventListener('click', clearLog);

// State 
let parsedSkills = [];  // { name, description, license, metadata, compatibility, files: Map, valid, errors[], warnings[] }
let originalZip = null;
let convertedZipBlob = null;

// Drop Zone 
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const convertBtn = document.getElementById('convertBtn');
const loadSampleBtn = document.getElementById('loadSampleBtn');
const resetBtn = document.getElementById('resetBtn');

// UI State helpers ─
function setBusy() {
  convertBtn.disabled = true;
  loadSampleBtn.disabled = true;
  fileInput.disabled = true;
  dropZone.classList.add('disabled');
  resetBtn.classList.remove('no_items');
}

function resetAll() {
  hideError();
  clearLog();
  document.getElementById('results').classList.remove('visible');
  document.getElementById('downloadArea').classList.remove('visible');
  document.getElementById('progressArea').classList.remove('visible');
  document.getElementById('resultsList').innerHTML = '';
  document.getElementById('summaryArea').innerHTML = '';

  // Re-enable upload and load sample
  convertBtn.disabled = true;
  loadSampleBtn.disabled = false;
  fileInput.disabled = false;
  dropZone.classList.remove('disabled');
  resetBtn.classList.add('no_items');

  // Reset state
  originalZip = null;
  convertedZipBlob = null;
  parsedSkills = [];
  fileInput.value = '';

  log('Reset complete', 'info');
}

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (fileInput.disabled) return;
  if (e.dataTransfer.files.length > 0) {
    fileInput.files = e.dataTransfer.files;
    handleFileUpload(e.dataTransfer.files[0]);
  }
});
fileInput.addEventListener('change', (e) => {
  if (fileInput.disabled) return;
  if (e.target.files.length > 0) handleFileUpload(e.target.files[0]);
});

async function handleFileUpload(file) {
  if (!file.name.endsWith('.zip')) {
    showError('Please upload a .zip file.');
    return;
  }
  hideError();
  log(`Loaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, 'info');
  try {
    const buffer = await file.arrayBuffer();
    originalZip = await JSZip.loadAsync(buffer);
    log(`Archive contains ${Object.keys(originalZip.files).length} entries`, 'success');
    convertBtn.disabled = false;
  } catch (err) {
    showError('Failed to read zip file: ' + err.message);
    log('Failed to read zip: ' + err.message, 'error');
  }
}

// Load Sample 
loadSampleBtn.addEventListener('click', async () => {
  if (loadSampleBtn.disabled) return;
  hideError();
  // Build a sample in-memory zip with a couple of skills
  const zip = new JSZip();

  // Skill 1: frontend-design
  zip.file('frontend-design/SKILL.md', `---
name: frontend-design
description: Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don't read as templated defaults.
license: Apache-2.0
metadata:
  author: anthropic
  source: https://github.com/anthropics/skills
---

# Frontend Design

Approach this as the design lead at a small studio known for giving every client a visual identity that could not be mistaken for anyone else's.

## Design Principles

Typography carries the personality of the page. Structure is information. Leverage motion deliberately.
`);
  zip.file('frontend-design/LICENSE.txt', 'Apache 2.0 License - placeholder');

  // Skill 2: pdf-processing
  zip.file('pdf-processing/SKILL.md', `---
name: pdf-processing
description: Extract PDF text, fill forms, merge files. Use when handling PDF documents.
license: MIT
---

# PDF Processing

Extract text and tables from PDF files, fill PDF forms, and merge multiple PDFs.
`);
  zip.file('pdf-processing/scripts/extract.py', '#!/usr/bin/env python3\nprint("Extracting PDF...")');
  zip.file('pdf-processing/references/REFERENCE.md', '# PDF Reference\nSee https://example.com/pdf-docs');

  // Skill 3: invalid skill (name mismatch)
  zip.file('bad-skill/SKILL.md', `---
name: different-name
description: This skill's name does not match the directory name.
---

This should fail validation.
`);

  // Skill 4: no SKILL.md
  zip.file('empty-skill/readme.txt', 'This directory has no SKILL.md');

  // Skill 5: files at zip root (no directory) — tests the "SKILL.md at root" detection
  zip.file('SKILL.md', `---
name: root-skill
description: This skill's SKILL.md is at the zip root instead of inside a named directory, which is invalid.
license: MIT
---

# Root Skill

Files must be placed inside a skill directory (e.g. "root-skill/").
`);
  zip.file('notes.txt', 'Some extra file at zip root level.');

  const blob = await zip.generateAsync({ type: 'blob' });
  const file = new File([blob], 'sample-skills.zip', { type: 'application/zip' });

  // Simulate file upload
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  await handleFileUpload(file);
  log('Sample data loaded. Click "Convert to Plugins" to process.', 'success');
});

// Error Display 
const errorBanner = document.getElementById('errorBanner');
function showError(msg) { errorBanner.textContent = msg; errorBanner.classList.add('visible'); }
function hideError() { errorBanner.classList.remove('visible'); }

// HTML Formatting Helpers 
function formatFileListHtml(files) {
  if (!files || files.length === 0) return '';
  return `<ul class="error-file-list">${files.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`;
}

/**
 * Group file paths by their top-level directory and return HTML.
 * Paths like "agents/analyzer.md", "scripts/run.py" get grouped
 * under their parent directory section.
 */
function formatGroupedFilesHtml(allFiles) {
  if (!allFiles || allFiles.length === 0) return '';
  // Group by first path segment (top-level dir)
  const groups = new Map(); // dir -> files[]
  const rootFiles = [];
  for (const f of allFiles) {
    const slashIdx = f.indexOf('/');
    if (slashIdx === -1) {
      rootFiles.push(f);
    } else {
      const dir = f.substring(0, slashIdx);
      const rest = f.substring(slashIdx + 1);
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push(rest);
    }
  }
  let html = '';
  if (rootFiles.length > 0) {
    html += `<span class="error-label">Files at zip root:</span>${formatFileListHtml(rootFiles)}`;
  }
  for (const [dir, files] of groups) {
    html += `<span class="error-label">Files in directory &ldquo;${escapeHtml(dir)}/&rdquo;:</span>${formatFileListHtml(files)}`;
  }
  return html;
}

// Name Validation 
function isValidSkillName(name) {
  if (!name || name.length > 64) return false;
  if (!/^[a-z0-9-]+$/.test(name)) return false;
  if (/^-/.test(name) || /-$/.test(name)) return false;
  if (/--/.test(name)) return false;
  return true;
}

// Parse SKILL.md ─
function parseSkillMd(content) {
  const result = { frontmatter: null, body: '', error: null };
  // Ensure content is a string (decode Uint8Array if needed)
  if (content instanceof Uint8Array) {
    content = new TextDecoder().decode(content);
  }
  // Must start with ---
  const trimmed = content.replace(/^\uFEFF/, ''); // strip BOM
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
  try {
    const fm = jsyaml.load(yamlStr);
    if (!fm || typeof fm !== 'object') {
      result.error = 'Frontmatter must be a YAML mapping';
      return result;
    }
    result.frontmatter = fm;
    result.body = body;
  } catch (e) {
    result.error = 'YAML parsing error: ' + e.message;
  }
  return result;
}

// Validate a skill ─
function validateSkill(skillDirName, files) {
  const errors = [];
  const warnings = [];

  // Must have SKILL.md (case-insensitive)
  const skillMdPath = `${skillDirName}/SKILL.md`;
  let skillMdContent = files.get(skillMdPath);

  if (!skillMdContent) {
    // Try case-insensitive match
    for (const [path, content] of files) {
      const pathLower = path.toLowerCase();
      const dirPrefix = skillDirName.toLowerCase() + '/';
      if (pathLower.endsWith('/skill.md') && pathLower.startsWith(dirPrefix)) {
        skillMdContent = content;
        break;
      }
    }
  }

  if (!skillMdContent) {
    errors.push('Missing SKILL.md — every skill needs one');
    return { valid: false, errors, warnings, name: skillDirName, description: '', license: '', metadata: null, compatibility: '' };
  }

  // Parse frontmatter
  const parsed = parseSkillMd(skillMdContent);
  if (parsed.error) {
    errors.push('Invalid SKILL.md: ' + parsed.error);
    return { valid: false, errors, warnings, name: skillDirName, description: '', license: '', metadata: null, compatibility: '', body: '' };
  }

  const fm = parsed.frontmatter;

  // Validate name
  if (!fm.name) {
    errors.push('Frontmatter must have a "name" field');
  } else if (typeof fm.name !== 'string') {
    errors.push('Frontmatter "name" must be a string');
  } else if (!isValidSkillName(fm.name)) {
    errors.push(`Invalid name "${fm.name}": lowercase, hyphens, no leading/trailing hyphen, no consecutive hyphens, max 64 chars`);
  } else if (fm.name !== skillDirName) {
    errors.push(`Name "${fm.name}" does not match directory name "${skillDirName}"`);
  }

  // Validate description
  if (!fm.description) {
    errors.push('Frontmatter must have a "description" field');
  } else if (typeof fm.description !== 'string') {
    errors.push('Frontmatter "description" must be a string');
  } else if (fm.description.length > 1024) {
    warnings.push('Description exceeds 1024 characters (AI agents may truncate)');
  }

  // License (optional)
  if (fm.license && typeof fm.license !== 'string') {
    warnings.push('"license" should be a string');
  }

  // Compatibility (optional, per spec: max 500 chars)
  if (fm.compatibility) {
    if (typeof fm.compatibility !== 'string') {
      warnings.push('"compatibility" should be a string');
    } else if (fm.compatibility.length > 500) {
      warnings.push('"compatibility" exceeds 500 characters');
    }
  }

  // Metadata (optional)
  if (fm.metadata && typeof fm.metadata !== 'object') {
    warnings.push('"metadata" should be a key-value mapping');
  }

  // Allowed-tools (optional, experimental)
  // Just check it's a string if present
  if (fm['allowed-tools'] && typeof fm['allowed-tools'] !== 'string') {
    warnings.push('"allowed-tools" should be a space-separated string');
  }

  const valid = errors.length === 0;
  return {
    valid,
    errors,
    warnings,
    name: fm.name || skillDirName,
    description: fm.description || '',
    license: fm.license || '',
    metadata: fm.metadata || null,
    compatibility: fm.compatibility || '',
    body: parsed.body,
    hasFrontmatter: true
  };
}

// Build plugin structure ─
function buildPlugin(skillName, validation, files) {
  const pluginZip = new JSZip();

  // All files go inside a top-level directory named after the skill
  const topDir = skillName;

  // .claude-plugin/plugin.json
  const pluginManifest = {
    id: skillName,
    name: skillName,
    description: validation.description || '',
    ...(validation.metadata?.author ? { author: { name: validation.metadata.author } } : {})
  };
  pluginZip.file(`${topDir}/.claude-plugin/plugin.json`, JSON.stringify(pluginManifest, null, 2));

  // skills/<name>/ — copy all original files, preserving structure
  // All files in the map belong to this skill; place them under skills/<name>/
  for (const [path, content] of files) {
    // Skip directories (JSZip includes them as entries with trailing /)
    if (path.endsWith('/')) continue;

    // Compute relative path: strip the skill directory prefix if present
    let relativePath;
    const prefix = `${skillName}/`;
    if (path.startsWith(prefix)) {
      relativePath = path.substring(prefix.length);
    } else {
      // File without the skill dir prefix (e.g. root-level SKILL.md)
      // Keep the original filename as the relative path
      relativePath = path;
    }

    const targetPath = `${topDir}/skills/${skillName}/${relativePath}`;
    pluginZip.file(targetPath, content);
  }

  return pluginZip;
}

// Main Conversion 
convertBtn.addEventListener('click', async () => {
  if (!originalZip) return;
  setBusy();

  const progressArea = document.getElementById('progressArea');
  const progressFill = document.getElementById('progressFill');
  const progressLabel = document.getElementById('progressLabel');
  const resultsEl = document.getElementById('results');
  const resultsList = document.getElementById('resultsList');
  const summaryArea = document.getElementById('summaryArea');
  const downloadArea = document.getElementById('downloadArea');

  // Reset UI
  hideError();
  progressArea.classList.add('visible');
  progressFill.style.width = '0%';
  progressLabel.textContent = 'Scanning archive...';
  resultsEl.classList.remove('visible');
  downloadArea.classList.remove('visible');
  parsedSkills = [];
  convertedZipBlob = null;

  try {
    // Step 1: Discover skills 
    const files = new Map();
    originalZip.forEach((relativePath, entry) => {
      if (!entry.dir) {
        files.set(relativePath, entry);
      }
    });

    log(`Scanning ${files.size} files for skill directories...`, 'info');
    progressFill.style.width = '20%';
    progressLabel.textContent = 'Discovering skills...';

    // Find top-level directories that contain SKILL.md (case-insensitive)
    const skillDirs = new Set();
    for (const [path] of files) {
      const parts = path.split('/');
      const last = parts[parts.length - 1];
      if (parts.length >= 2 && last.toLowerCase() === 'skill.md') {
        // The skill directory is the parent
        const dirName = parts[0];
        skillDirs.add(dirName);
      } else if (parts.length === 1 && last.toLowerCase() === 'skill.md') {
        // SKILL.md at root — treat root as a skill dir
        skillDirs.add('');
      }
    }

    // Also discover top-level directories that have no SKILL.md at all,
    // but only when there are 2+ properly-structured skill directories
    // (non-root). This catches dirs like `pdf/` in a multi-skill zip that
    // exist alongside real skills but lack SKILL.md themselves, while not
    // exploding single-skill zips with stray support folders into many
    // separate "skills".
    const properSkillCount = [...skillDirs].filter(sd => sd !== '').length;
    if (properSkillCount >= 2) {
      for (const [path] of files) {
        const parts = path.split('/');
        if (parts.length >= 2) {
          const dirName = parts[0];
          if (!skillDirs.has(dirName)) {
            skillDirs.add(dirName);
          }
        }
      }
    }

    log(`Found ${skillDirs.size} potential skill director${skillDirs.size === 1 ? 'y' : 'ies'}`, 'info');
    progressFill.style.width = '40%';
    progressLabel.textContent = 'Validating skills...';

    // Step 2: Validate each skill 
    let processed = 0;
    for (const dirName of skillDirs) {
      // Collect files for this skill
      const skillFiles = new Map();
      if (dirName === '') {
        // Collection for root entry: grab ALL files that are not inside
        // any OTHER discovered skill directory.
        const otherDirs = new Set(skillDirs);
        otherDirs.delete('');
        for (const [path, entry] of files) {
          let claimed = false;
          for (const sd of otherDirs) {
            if (path.startsWith(sd + '/')) {
              claimed = true;
              break;
            }
          }
          if (!claimed) {
            const content = await entry.async('uint8array');
            skillFiles.set(path, content);
          }
        }
      } else {
        for (const [path, entry] of files) {
          if (path.startsWith(dirName + '/') || path === dirName) {
            const content = await entry.async('uint8array');
            skillFiles.set(path, content);
          }
        }
      }

      let validation;
      if (dirName === '') {
        // Files at zip root — not a valid skill per spec:
        // "A skill is a directory containing, at minimum, a SKILL.md file"
        const allFiles = Array.from(skillFiles.keys()).filter(f => !f.endsWith('/')).sort();
        const rootLevel = allFiles.filter(f => !f.includes('/'));
        const skillMdFile = rootLevel.find(f => f.toLowerCase() === 'skill.md');
        const hasSkillMd = !!skillMdFile;

        if (hasSkillMd) {
          const parsed = parseSkillMd(skillFiles.get(skillMdFile));
          const skillName = parsed.frontmatter?.name || 'unknown';

          // List all misplaced files
          const rootExtra = rootLevel.filter(f => f.toLowerCase() !== 'skill.md');
          const subDir = allFiles.filter(f => f.includes('/'));
          const detailsHtml = rootExtra.length > 0 || subDir.length > 0
            ? `<br>${formatGroupedFilesHtml([...rootExtra, ...subDir])}` : '';

          validation = {
            valid: false,
            errors: [`All skill files must be inside a skill directory (e.g. "${skillName}/"). SKILL.md is at zip root.${detailsHtml}`],
            warnings: [],
            name: skillName,
            description: parsed.frontmatter?.description || '',
            license: parsed.frontmatter?.license || '',
            metadata: parsed.frontmatter?.metadata || null,
            compatibility: parsed.frontmatter?.compatibility || '',
            body: parsed.body || ''
          };
        } else {
          // No SKILL.md — report all files as orphaned
          const subDir = allFiles.filter(f => f.includes('/'));
          const filesToShow = rootLevel.length > 0 || subDir.length > 0 ? [...rootLevel, ...subDir] : [];
          const detailsHtml = filesToShow.length > 0 ? `<br>${formatGroupedFilesHtml(filesToShow)}` : ' Zip has no files.';
          validation = {
            valid: false,
            errors: [`No SKILL.md found. A skill must be a directory containing SKILL.md.${detailsHtml}`],
            warnings: [],
            name: 'unknown',
            description: '',
            license: '',
            metadata: null,
            compatibility: '',
            body: ''
          };
        }
        parsedSkills.push({
          dirName: '–',
          validation,
          files: skillFiles,
          plugin: null
        });
      } else {
        validation = validateSkill(dirName, skillFiles);
        parsedSkills.push({
          dirName,
          validation,
          files: skillFiles,
          plugin: null
        });
      }
      processed++;
      progressFill.style.width = `${40 + (processed / skillDirs.size) * 30}%`;
    }

    // Step 3: Check for orphaned files outside any skill dir 
    const hasRootEntry = skillDirs.has('');
    const hasValidDirs = [...skillDirs].some(sd => sd !== '');

    if (hasValidDirs) {
      // Collect files NOT inside any valid skill directory
      const orphanFiles = new Map();
      if (!hasRootEntry) {
        for (const [path, entry] of files) {
          let inside = false;
          for (const sd of skillDirs) {
            if (sd === '') continue;
            if (path.startsWith(sd + '/')) {
              inside = true;
              break;
            }
          }
          if (!inside) {
            const content = await entry.async('uint8array');
            orphanFiles.set(path, content);
          }
        }
      }
      if (orphanFiles.size > 0) {
        const names = Array.from(orphanFiles.keys()).filter(f => !f.endsWith('/')).sort();
        const groupedHtml = formatGroupedFilesHtml(names);
        // Invalidate each previously valid skill with the orphan error
        // so the stray files show up inside the skill card rather than
        // as a separate phantom entry.  In multi-skill zips there will
        // be no orphan files (non-SKILL.md dirs are added as skills),
        // so this only fires for single-skill zips with stray files.
        for (const ps of parsedSkills) {
          if (ps.validation.valid) {
            ps.validation.valid = false;
            ps.validation.errors.push(`Stray files found outside skill directory:<br>${groupedHtml}<br>All files must be inside the skill directory.`);
          }
        }
      }
    } else if (!hasRootEntry) {
      // No skills discovered at all — report all files as orphaned
      const allFilesList = Array.from(files.keys()).filter(f => !f.endsWith('/')).sort();
      const rootLevel = allFilesList.filter(f => !f.includes('/'));
      const subDir = allFilesList.filter(f => f.includes('/'));
      const filesToShow = rootLevel.length > 0 || subDir.length > 0 ? [...rootLevel, ...subDir] : [];
      const detailsHtml = filesToShow.length > 0 ? `<br>${formatGroupedFilesHtml(filesToShow)}` : ' Zip has no files.';
      parsedSkills.push({
        dirName: '–',
        validation: {
          valid: false,
          errors: [`No SKILL.md found. A skill must be a directory containing SKILL.md.${detailsHtml}`],
          warnings: [],
          name: 'unknown',
          description: '',
          license: '',
          metadata: null,
          compatibility: '',
          body: ''
        },
        files,
        plugin: null
      });
    }

    // Step 4: Convert valid skills ─
    progressLabel.textContent = 'Converting to plugins...';
    let converted = 0;
    const validSkills = parsedSkills.filter(s => s.validation.valid);

    for (const skill of validSkills) {
      const pluginName = skill.validation.name || skill.dirName;
      skill.plugin = buildPlugin(pluginName, skill.validation, skill.files);
      converted++;
    }

    progressFill.style.width = '90%';
    progressLabel.textContent = 'Finalizing...';

    // Step 5: Build combined download 
    if (validSkills.length > 0) {
      const combinedZip = new JSZip();
      const filePromises = [];

      for (const skill of validSkills) {
        const pluginZip = skill.plugin;
        // Merge plugin zip into combined
        // buildPlugin already prefixes all paths with the skill name,
        // so we just copy entries as-is (no extra wrapping)
        pluginZip.forEach((path, entry) => {
          if (!entry.dir) {
            // Collect each async read; resolve and add to zip before generating
            filePromises.push(
              entry.async('uint8array').then(content => {
                combinedZip.file(path, content);
              })
            );
          }
        });
      }

      // Wait for all file reads to complete before generating
      await Promise.all(filePromises);
      convertedZipBlob = await combinedZip.generateAsync({ type: 'blob' });
    }

    // Step 6: Display Results 
    progressFill.style.width = '100%';
    progressLabel.textContent = 'Done!';

    displayResults(parsedSkills);
    resultsEl.classList.add('visible');

    if (validSkills.length > 0) {
      downloadArea.classList.add('visible');
      document.getElementById('downloadInfo').textContent = `${validSkills.length} plugin${validSkills.length > 1 ? 's' : ''} ready`;
      // Hide "Download All" if only 1 skill (redundant with "Download Individual")
      document.getElementById('downloadAllBtn').classList.toggle('no_items', validSkills.length <= 1);
    }

    const orphanCount = parsedSkills.filter(s => s.isOrphan).length;
    const skippedCount = parsedSkills.filter(s => !s.isOrphan && !s.validation.valid).length;
    log(`Conversion complete: ${validSkills.length} valid, ${skippedCount} skipped${orphanCount ? `, ${orphanCount} issue` : ''}`, validSkills.length > 0 ? 'success' : 'warn');

  } catch (err) {
    showError('Conversion failed: ' + err.message);
    log('Conversion error: ' + err.message + '\n' + err.stack, 'error');
  }

  // Re-enable convert button but keep upload/load disabled until reset
  convertBtn.disabled = false;

  // Hide progress after a moment
  setTimeout(() => {
    progressArea.classList.remove('visible');
  }, 1500);
});

// Display Results 
function displayResults(skills) {
  const resultsList = document.getElementById('resultsList');
  const summaryArea = document.getElementById('summaryArea');
  resultsList.innerHTML = '';
  summaryArea.innerHTML = '';

  const realSkills = skills.filter(s => !s.isOrphan);
  const total = realSkills.length;
  const valid = realSkills.filter(s => s.validation.valid).length;
  const invalid = realSkills.filter(s => !s.validation.valid && s.validation.errors.length > 0).length;
  const warning = realSkills.filter(s => s.validation.warnings.length > 0).length;

  summaryArea.innerHTML = `
    <div class="summary-item"><div class="number num-accent">${total}</div><div class="label">Total Skills</div></div>
    <div class="summary-item"><div class="number num-success">${valid}</div><div class="label">Valid</div></div>
    <div class="summary-item"><div class="number num-error">${invalid}</div><div class="label">Invalid</div></div>
    <div class="summary-item"><div class="number num-warning">${warning}</div><div class="label">With Warnings</div></div>
  `;

  for (const skill of skills) {
    const v = skill.validation;
    const card = document.createElement('div');
    card.className = 'skill-card fade-in';

    const statusClass = v.valid ? 'valid' : 'invalid';
    const statusLabel = v.valid ? '✓ Valid' : '✗ Invalid';

    // Determine file count
    const fileList = Array.from(skill.files.keys()).filter(f => !f.endsWith('/'));
    const extraFiles = fileList.filter(f => !f.endsWith('SKILL.md') && !f.endsWith('/SKILL.md'));

    let filesHtml = '';
    if (extraFiles.length > 0) {
      const maxShow = 5;
      const shown = extraFiles.slice(0, maxShow);
      filesHtml = shown.map(f => {
        const parts = f.split('/');
        return `${parts[parts.length - 1]}`;
      }).join(', ');
      if (extraFiles.length > maxShow) {
        filesHtml += ` <span class="more-files">+${extraFiles.length - maxShow} more</span>`;
      }
    }

    let issuesHtml = '';
    for (const err of v.errors) {
      issuesHtml += `<div class="issue-error">✗ ${err}</div>`;
    }
    for (const warn of v.warnings) {
      issuesHtml += `<div class="issue-warning">⚠ ${warn}</div>`;
    }

    card.innerHTML = `
      <div class="skill-header">
        <div>
          <span class="skill-name">${skill.dirName}</span>
          <span class="skill-tag ${statusClass}">${statusLabel}</span>
        </div>
        <div class="file-count">
          ${fileList.length} file${fileList.length !== 1 ? 's' : ''}
        </div>
      </div>
      <div class="skill-info-line skill-info-top"><strong>Name:</strong> ${escapeHtml(v.name)}</div>
      ${v.description ? `<div class="skill-info-line skill-info-sub"><strong>Desc:</strong> ${escapeHtml(v.description.substring(0, 200))}${v.description.length > 200 ? '…' : ''}</div>` : ''}
      ${filesHtml ? `<div class="skill-info-line skill-info-sub"><strong>Files:</strong> ${filesHtml}</div>` : ''}
      ${issuesHtml}
    `;

    resultsList.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Download Handlers 
document.getElementById('downloadAllBtn').addEventListener('click', () => {
  if (!convertedZipBlob) return;
  const url = URL.createObjectURL(convertedZipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'converted-plugins.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  log('Downloaded: converted-plugins.zip', 'success');
});

document.getElementById('downloadIndividualBtn').addEventListener('click', async () => {
  const validSkills = parsedSkills.filter(s => s.validation.valid);
  if (validSkills.length === 0) return;

  if (validSkills.length === 1) {
    // Single skill - download directly
    const skill = validSkills[0];
    const pluginName = skill.validation.name || skill.dirName;
    const blob = await skill.plugin.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pluginName}.plugin.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log(`Downloaded: ${pluginName}.plugin.zip`, 'success');
  } else {
    // Multiple - show a picker
    const names = validSkills.map(s => s.validation.name || s.dirName);
    const choice = prompt(`Enter the plugin name to download individually:\n\nAvailable: ${names.join(', ')}`);
    if (!choice) return;
    const skill = validSkills.find(s => (s.validation.name === choice) || (s.dirName === choice));
    if (!skill) {
      log(`Plugin "${choice}" not found`, 'error');
      return;
    }
    const pluginName = skill.validation.name || skill.dirName;
    const blob = await skill.plugin.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pluginName}.plugin.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log(`Downloaded: ${pluginName}.plugin.zip`, 'success');
  }
});

// Reset Handler 
resetBtn.addEventListener('click', resetAll);
