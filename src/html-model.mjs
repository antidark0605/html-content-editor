import { parse } from 'parse5';

const BLOCKED_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'title',
  'textarea',
  'option',
  'svg',
  'math',
  'canvas'
]);

const ASCII_WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f']);

function trimAsciiWhitespaceBounds(raw) {
  let left = 0;
  let right = raw.length;

  while (left < right && ASCII_WHITESPACE.has(raw[left])) left += 1;
  while (right > left && ASCII_WHITESPACE.has(raw[right - 1])) right -= 1;

  return { left, right };
}

function trimAsciiWhitespace(value) {
  let left = 0;
  let right = value.length;

  while (left < right && ASCII_WHITESPACE.has(value[left])) left += 1;
  while (right > left && ASCII_WHITESPACE.has(value[right - 1])) right -= 1;

  return value.slice(left, right);
}

function attributeValue(node, name) {
  return node?.attrs?.find((attr) => attr.name === name)?.value ?? null;
}

function semanticAlignmentBase(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const element = ancestors[index];
    const tagName = typeof element?.tagName === 'string'
      ? element.tagName.toLowerCase()
      : null;

    if (tagName === 'a') {
      const href = attributeValue(element, 'href');
      if (href) return `anchor:${href}`;
    }
  }

  const parent = ancestors.at(-1);
  const parentTag = typeof parent?.tagName === 'string'
    ? parent.tagName.toLowerCase()
    : null;
  const parentId = attributeValue(parent, 'id');

  if (parentTag && parentId) {
    return `element:${parentTag}#${parentId}`;
  }

  return null;
}

export function escapeHtmlText(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function extractEditableTextNodes(source) {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const editable = [];
  const semanticOccurrences = new Map();
  let nextId = 1;

  function visit(node, blockedByAncestor = false, ancestors = []) {
    const tagName = typeof node.tagName === 'string' ? node.tagName.toLowerCase() : null;
    const blockedHere = blockedByAncestor || (tagName !== null && BLOCKED_TAGS.has(tagName));

    if (
      node.nodeName === '#text' &&
      !blockedByAncestor &&
      node.sourceCodeLocation &&
      Number.isInteger(node.sourceCodeLocation.startOffset) &&
      Number.isInteger(node.sourceCodeLocation.endOffset)
    ) {
      const raw = source.slice(
        node.sourceCodeLocation.startOffset,
        node.sourceCodeLocation.endOffset
      );
      const { left, right } = trimAsciiWhitespaceBounds(raw);

      if (right > left) {
        const start = node.sourceCodeLocation.startOffset + left;
        const end = node.sourceCodeLocation.startOffset + right;
        const text = trimAsciiWhitespace(node.value ?? '');

        if (text.length > 0) {
          const semanticBase = semanticAlignmentBase(ancestors);
          let alignmentKey = null;

          if (semanticBase) {
            const occurrence = (semanticOccurrences.get(semanticBase) ?? 0) + 1;
            semanticOccurrences.set(semanticBase, occurrence);
            alignmentKey = `${semanticBase}::${occurrence}`;
          }

          editable.push({
            id: `text-${nextId++}`,
            start,
            end,
            text,
            alignmentKey
          });
        }
      }
    }

    const nextAncestors = tagName ? [...ancestors, node] : ancestors;

    for (const child of node.childNodes ?? []) {
      visit(child, blockedHere, nextAncestors);
    }

    if (node.content) {
      visit(node.content, blockedHere, nextAncestors);
    }
  }

  visit(document);
  return editable;
}

export function applyTextEdits(source, textNodes, edits) {
  const byId = new Map(textNodes.map((node) => [node.id, node]));
  const replacements = [];

  for (const [id, value] of Object.entries(edits ?? {})) {
    const node = byId.get(id);
    if (!node || typeof value !== 'string') continue;

    replacements.push({
      start: node.start,
      end: node.end,
      replacement: escapeHtmlText(value)
    });
  }

  replacements.sort((a, b) => b.start - a.start);

  let result = source;
  let lastStart = Number.POSITIVE_INFINITY;

  for (const replacement of replacements) {
    if (replacement.end > lastStart) {
      throw new Error('Overlapping HTML text edits were detected.');
    }

    result =
      result.slice(0, replacement.start) +
      replacement.replacement +
      result.slice(replacement.end);

    lastStart = replacement.start;
  }

  return result;
}

export function buildEditableHtml(source, textNodes, edits = {}) {
  const parts = [];
  let cursor = 0;

  for (const node of textNodes) {
    parts.push(source.slice(cursor, node.start));

    const content = Object.hasOwn(edits, node.id)
      ? escapeHtmlText(edits[node.id])
      : source.slice(node.start, node.end);

    parts.push(
      `<span data-hce-id="${node.id}" contenteditable="plaintext-only" spellcheck="false">${content}</span>`
    );

    cursor = node.end;
  }

  parts.push(source.slice(cursor));
  return parts.join('');
}
