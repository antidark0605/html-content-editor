import { parse } from 'parse5';
import { extractEditableTextNodes } from './html-model.mjs';

// Only elements with a real source range can be deleted without rewriting HTML.
const DELETABLE_TAGS = new Set([
  'span', 'strong', 'em', 'b', 'i', 'u', 'mark', 'a',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'ul', 'ol', 'div', 'section', 'article',
  'aside', 'blockquote', 'figure', 'figcaption', 'nav',
  'header', 'footer'
]);

const UNSAFE_CONTAINERS = new Set(['script', 'style', 'template', 'noscript']);

function findSourceTextNode(root, start, end) {
  if (
    root.nodeName === '#text' &&
    root.sourceCodeLocation?.startOffset <= start &&
    root.sourceCodeLocation?.endOffset >= end
  ) {
    return root;
  }

  for (const child of root.childNodes ?? []) {
    const found = findSourceTextNode(child, start, end);
    if (found) return found;
  }

  return root.content ? findSourceTextNode(root.content, start, end) : null;
}

function summarizeContent(node) {
  let output = '';
  const visit = (child) => {
    if (output.length >= 90) return;
    if (child.nodeName === '#text') {
      output += child.value ?? '';
    } else if (!UNSAFE_CONTAINERS.has(child.tagName)) {
      for (const descendant of child.childNodes ?? []) visit(descendant);
    }
  };
  visit(node);
  return output.replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function listDeletableElementAncestors(source, textNodeId) {
  if (typeof source !== 'string' || typeof textNodeId !== 'string') return [];

  const text = extractEditableTextNodes(source).find((node) => node.id === textNodeId);
  if (!text) return [];

  const document = parse(source, { sourceCodeLocationInfo: true });
  let current = findSourceTextNode(document, text.start, text.end)?.parentNode;
  const ancestors = [];

  while (current) {
    const tag = current.tagName;
    const loc = current.sourceCodeLocation;
    const validRange = Number.isInteger(loc?.startOffset) &&
      Number.isInteger(loc?.endOffset) &&
      loc.endOffset > loc.startOffset &&
      loc.startTag &&
      (loc.endTag || tag === 'li' || tag === 'p');

    if (DELETABLE_TAGS.has(tag) && validRange) {
      const start = loc.startOffset;
      const end = loc.endOffset;
      ancestors.push({
        tag,
        key: `${tag}:${start}:${end}`,
        start,
        end,
        preview: summarizeContent(current)
      });
    }
    current = current.parentNode;
  }

  return ancestors;
}

export function deleteHtmlElement(source, { textNodeId, key } = {}) {
  if (typeof source !== 'string' || typeof key !== 'string') {
    throw new Error('Invalid element deletion request.');
  }

  const candidate = listDeletableElementAncestors(source, textNodeId)
    .find((item) => item.key === key);
  if (!candidate) {
    throw new Error('The selected element changed. Select it again.');
  }

  return source.slice(0, candidate.start) + source.slice(candidate.end);
}
