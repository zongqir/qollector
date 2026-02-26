import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const STYLE_ROOT = path.join(ROOT_DIR, 'src', 'styles');
const BASELINE_PATH = path.join(ROOT_DIR, 'scripts', 'style-guard-baseline.json');
const ALLOW_MARKER = 'style-guard-allow';

const COLOR_PATTERN = /(#[0-9a-fA-F]{3,8}\b)|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g;
const DURATION_PATTERN = /\b\d*\.?\d+(?:ms|s)\b/g;
const EASING_PATTERN = /(?<!-)\bease(?:-in|-out|-in-out)?\b(?!-)|(?<!-)\blinear\b(?!-)|\bcubic-bezier\([^)]*\)|\bsteps\([^)]*\)/g;
const TIMING_SCOPE_PATTERN = /\b(?:transition|animation)(?:-[a-z-]+)?\b/;
const VAR_DECLARATION_PATTERN = /^\s*--[a-z0-9-]+\s*:/i;
const BLOCK_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;

const DEFAULT_MAX_PRINT = 80;

function parseArgs(argv) {
  const parsed = {
    mode: 'report',
    updateBaseline: false,
    maxPrint: DEFAULT_MAX_PRINT,
  };

  argv.forEach((arg) => {
    if (arg.startsWith('--mode=')) {
      parsed.mode = arg.slice('--mode='.length).trim();
      return;
    }
    if (arg === '--update-baseline') {
      parsed.updateBaseline = true;
      return;
    }
    if (arg.startsWith('--max-print=')) {
      const value = Number(arg.slice('--max-print='.length).trim());
      if (Number.isFinite(value) && value > 0) {
        parsed.maxPrint = Math.floor(value);
      }
    }
  });

  return parsed;
}

function normalizeSnippet(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function sanitizeForSignature(value) {
  return String(value || '')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function walkCssFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  entries.forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkCssFiles(fullPath));
      return;
    }
    if (entry.isFile() && entry.name.endsWith('.css')) {
      files.push(fullPath);
    }
  });
  return files;
}

function stripInlineComments(line) {
  return line.replace(BLOCK_COMMENT_PATTERN, '');
}

function hasAllowMarker(line, prevLine) {
  return (line && line.includes(ALLOW_MARKER)) || (prevLine && prevLine.includes(ALLOW_MARKER));
}

function makeIssue({ rule, file, line, column, match, snippet }) {
  const normalizedSnippet = normalizeSnippet(snippet);
  const signature = [
    rule,
    file,
    sanitizeForSignature(normalizedSnippet),
    sanitizeForSignature(match),
  ].join('|');
  return {
    rule,
    file,
    line,
    column,
    match,
    snippet: normalizedSnippet,
    signature,
  };
}

function collectLineIssues(filePath, rawLine, prevLine, lineNumber) {
  const relativePath = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
  const issues = [];
  if (hasAllowMarker(rawLine, prevLine)) return issues;

  const line = stripInlineComments(rawLine);
  if (!line.trim()) return issues;

  const isVarDeclaration = VAR_DECLARATION_PATTERN.test(line);
  if (!isVarDeclaration) {
    let colorMatch;
    while ((colorMatch = COLOR_PATTERN.exec(line)) !== null) {
      const matchValue = colorMatch[0];
      issues.push(makeIssue({
        rule: 'hardcoded-color',
        file: relativePath,
        line: lineNumber,
        column: colorMatch.index + 1,
        match: matchValue,
        snippet: rawLine,
      }));
    }
  }

  const hasTimingScope = TIMING_SCOPE_PATTERN.test(line);
  if (hasTimingScope && !isVarDeclaration) {
    let durationMatch;
    while ((durationMatch = DURATION_PATTERN.exec(line)) !== null) {
      const matchValue = durationMatch[0];
      issues.push(makeIssue({
        rule: 'literal-motion-duration',
        file: relativePath,
        line: lineNumber,
        column: durationMatch.index + 1,
        match: matchValue,
        snippet: rawLine,
      }));
    }

    let easingMatch;
    while ((easingMatch = EASING_PATTERN.exec(line)) !== null) {
      const matchValue = easingMatch[0];
      issues.push(makeIssue({
        rule: 'literal-motion-easing',
        file: relativePath,
        line: lineNumber,
        column: easingMatch.index + 1,
        match: matchValue,
        snippet: rawLine,
      }));
    }
  }

  COLOR_PATTERN.lastIndex = 0;
  DURATION_PATTERN.lastIndex = 0;
  EASING_PATTERN.lastIndex = 0;
  return issues;
}

function collectIssues(styleFiles) {
  const issues = [];
  styleFiles.forEach((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    let prevLine = '';
    let inCustomPropertyBlock = false;
    lines.forEach((line, idx) => {
      const startsCustomProperty = /^\s*--[a-z0-9-]+\s*:/i.test(line);
      const endsDeclaration = line.includes(';');

      if (inCustomPropertyBlock) {
        if (endsDeclaration) {
          inCustomPropertyBlock = false;
        }
        prevLine = line;
        return;
      }

      if (startsCustomProperty) {
        if (!endsDeclaration) {
          inCustomPropertyBlock = true;
        }
        prevLine = line;
        return;
      }

      const lineIssues = collectLineIssues(filePath, line, prevLine, idx + 1);
      issues.push(...lineIssues);
      prevLine = line;
    });
  });
  return issues;
}

function toCountMap(issues) {
  const counts = new Map();
  issues.forEach((issue) => {
    counts.set(issue.signature, (counts.get(issue.signature) || 0) + 1);
  });
  return counts;
}

function printIssueList(issues, maxPrint) {
  const printCount = Math.min(issues.length, maxPrint);
  for (let i = 0; i < printCount; i += 1) {
    const issue = issues[i];
    console.log(
      `- [${issue.rule}] ${issue.file}:${issue.line}:${issue.column} | ${issue.match} | ${issue.snippet}`,
    );
  }
  if (issues.length > printCount) {
    console.log(`... and ${issues.length - printCount} more`);
  }
}

function buildBaselinePayload(issues) {
  const signatureCounts = {};
  const signatures = toCountMap(issues);
  signatures.forEach((count, signature) => {
    signatureCounts[signature] = count;
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    issueCount: issues.length,
    signatureCounts,
  };
}

function writeBaseline(issues) {
  const payload = buildBaselinePayload(issues);
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    return null;
  }
  const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.signatureCounts) {
    throw new Error('Invalid baseline format.');
  }
  return parsed;
}

function collectNewIssues(currentIssues, baseline) {
  const baselineCounts = new Map(Object.entries(baseline.signatureCounts || {}));
  const currentCounts = toCountMap(currentIssues);
  const remainingNewCountBySignature = new Map();

  currentCounts.forEach((currentCount, signature) => {
    const baselineCount = Number(baselineCounts.get(signature) || 0);
    if (currentCount > baselineCount) {
      remainingNewCountBySignature.set(signature, currentCount - baselineCount);
    }
  });

  if (remainingNewCountBySignature.size === 0) {
    return [];
  }

  const newIssues = [];
  currentIssues.forEach((issue) => {
    const left = remainingNewCountBySignature.get(issue.signature) || 0;
    if (left <= 0) return;
    newIssues.push(issue);
    remainingNewCountBySignature.set(issue.signature, left - 1);
  });
  return newIssues;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(STYLE_ROOT)) {
    console.error(`Style root not found: ${STYLE_ROOT}`);
    process.exit(1);
  }
  if (!['report', 'strict'].includes(args.mode)) {
    console.error(`Unsupported mode "${args.mode}". Use --mode=report|strict`);
    process.exit(1);
  }

  const styleFiles = walkCssFiles(STYLE_ROOT).sort();
  const issues = collectIssues(styleFiles);
  const byRule = issues.reduce((acc, issue) => {
    acc[issue.rule] = (acc[issue.rule] || 0) + 1;
    return acc;
  }, {});

  console.log(`[style-guard] scanned files: ${styleFiles.length}`);
  console.log(`[style-guard] total issues: ${issues.length}`);
  Object.entries(byRule).forEach(([rule, count]) => {
    console.log(`[style-guard] ${rule}: ${count}`);
  });

  if (args.updateBaseline) {
    const payload = writeBaseline(issues);
    console.log(`[style-guard] baseline updated: ${BASELINE_PATH}`);
    console.log(`[style-guard] baseline issueCount: ${payload.issueCount}`);
  }

  if (args.mode === 'report') {
    printIssueList(issues, args.maxPrint);
    process.exit(0);
  }

  const baseline = readBaseline();
  if (!baseline) {
    console.error(`[style-guard] baseline missing: ${BASELINE_PATH}`);
    console.error('[style-guard] run --mode=report --update-baseline first.');
    process.exit(1);
  }

  const newIssues = collectNewIssues(issues, baseline);
  console.log(`[style-guard] baseline issueCount: ${baseline.issueCount || 0}`);
  console.log(`[style-guard] new issues vs baseline: ${newIssues.length}`);

  if (newIssues.length > 0) {
    printIssueList(newIssues, args.maxPrint);
    process.exit(1);
  }

  process.exit(0);
}

main();
