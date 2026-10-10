import { diffArrays, diffWordsWithSpace } from 'diff';
import {
  applyTextEdits,
  escapeHtmlText,
  extractEditableTextNodes
} from './html-model.mjs';

function buildSequenceHunks(leftValues, rightValues) {
  const parts = diffArrays(leftValues, rightValues);
  const hunks = [];
  const anchors = [];
  let leftIndex = 0;
  let rightIndex = 0;
  let partIndex = 0;
  let nextHunk = 1;

  while (partIndex < parts.length) {
    const part = parts[partIndex];

    if (!part.added && !part.removed) {
      for (let i = 0; i < part.value.length; i += 1) {
        anchors.push({
          leftIndex: leftIndex + i,
          rightIndex: rightIndex + i
        });
      }
      leftIndex += part.value.length;
      rightIndex += part.value.length;
      partIndex += 1;
      continue;
    }

    const leftStart = leftIndex;
    const rightStart = rightIndex;
    let leftCount = 0;
    let rightCount = 0;

    while (partIndex < parts.length) {
      const changed = parts[partIndex];
      if (!changed.added && !changed.removed) break;

      if (changed.removed) {
        leftCount += changed.value.length;
        leftIndex += changed.value.length;
      }

      if (changed.added) {
        rightCount += changed.value.length;
        rightIndex += changed.value.length;
      }

      partIndex += 1;
    }

    hunks.push({
      id: `diff-${nextHunk++}`,
      leftStart,
      leftCount,
      rightStart,
      rightCount,
      kind: leftCount > 0 && rightCount > 0
        ? 'changed'
        : leftCount > 0
          ? 'removed'
          : 'added'
    });
  }

  return { hunks, anchors };
}

function inlineParts(leftText, rightText) {
  const parts = diffWordsWithSpace(leftText, rightText);

  return {
    left: parts
      .filter((part) => !part.added)
      .map((part) => ({ text: part.value, changed: Boolean(part.removed) })),
    right: parts
      .filter((part) => !part.removed)
      .map((part) => ({ text: part.value, changed: Boolean(part.added) }))
  };
}

function renderInlineParts(parts, side) {
  return parts.map((part) => {
    const text = escapeHtmlText(part.text);
    if (!part.changed) return text;
    return `<span class="hce-inline-diff hce-inline-${side}">${text}</span>`;
  }).join('');
}

function instrumentVisibleSide(source, nodes, annotations) {
  const chunks = [];
  let cursor = 0;

  for (const node of nodes) {
    chunks.push(source.slice(cursor, node.start));

    const annotation = annotations[node.id];
    const body = annotation
      ? renderInlineParts(annotation.parts, annotation.side)
      : source.slice(node.start, node.end);

    const attrs = [
      `data-hce-compare-id="${node.id}"`
    ];

    let className = 'hce-compare-node';

    if (annotation) {
      attrs.push(`data-hce-hunk="${annotation.hunkId}"`);
      className += ` hce-compare-${annotation.kind} hce-compare-${annotation.side}`;
    }

    chunks.push(
      `<span class="${className}" ${attrs.join(' ')}>${body}</span>`
    );

    cursor = node.end;
  }

  chunks.push(source.slice(cursor));
  return chunks.join('');
}

export function buildVisibleComparison(leftSource, rightSource) {
  const leftNodes = extractEditableTextNodes(leftSource);
  const rightNodes = extractEditableTextNodes(rightSource);
  const leftTexts = leftNodes.map((node) => node.text);
  const rightTexts = rightNodes.map((node) => node.text);
  const sequence = buildSequenceHunks(leftTexts, rightTexts);

  const leftAnnotations = {};
  const rightAnnotations = {};
  const anchors = sequence.anchors.map((anchor) => ({
    leftId: leftNodes[anchor.leftIndex]?.id ?? null,
    rightId: rightNodes[anchor.rightIndex]?.id ?? null
  })).filter((anchor) => anchor.leftId && anchor.rightId);

  const hunks = sequence.hunks.map((hunk) => {
    const leftSlice = leftNodes.slice(hunk.leftStart, hunk.leftStart + hunk.leftCount);
    const rightSlice = rightNodes.slice(hunk.rightStart, hunk.rightStart + hunk.rightCount);
    const pairedCount = Math.min(leftSlice.length, rightSlice.length);

    for (let i = 0; i < pairedCount; i += 1) {
      const leftNode = leftSlice[i];
      const rightNode = rightSlice[i];
      const details = inlineParts(leftNode.text, rightNode.text);

      leftAnnotations[leftNode.id] = {
        hunkId: hunk.id,
        kind: 'changed',
        side: 'left',
        parts: details.left
      };
      rightAnnotations[rightNode.id] = {
        hunkId: hunk.id,
        kind: 'changed',
        side: 'right',
        parts: details.right
      };

      anchors.push({ leftId: leftNode.id, rightId: rightNode.id });
    }

    for (const node of leftSlice.slice(pairedCount)) {
      leftAnnotations[node.id] = {
        hunkId: hunk.id,
        kind: 'removed',
        side: 'left',
        parts: [{ text: node.text, changed: true }]
      };
    }

    for (const node of rightSlice.slice(pairedCount)) {
      rightAnnotations[node.id] = {
        hunkId: hunk.id,
        kind: 'added',
        side: 'right',
        parts: [{ text: node.text, changed: true }]
      };
    }

    return {
      ...hunk,
      mergeableText: leftSlice.length > 0 && leftSlice.length === rightSlice.length,
      leftNodeIds: leftSlice.map((node) => node.id),
      rightNodeIds: rightSlice.map((node) => node.id),
      leftPreview: leftSlice.map((node) => node.text).join(' ').slice(0, 160),
      rightPreview: rightSlice.map((node) => node.text).join(' ').slice(0, 160)
    };
  });

  return {
    leftHtml: instrumentVisibleSide(leftSource, leftNodes, leftAnnotations),
    rightHtml: instrumentVisibleSide(rightSource, rightNodes, rightAnnotations),
    hunks,
    anchors
  };
}

export function splitSourceLines(source) {
  if (source.length === 0) return [];
  const matches = source.match(/.*?(?:\r\n|\n|\r|$)/g) ?? [];
  if (matches.at(-1) === '') matches.pop();
  return matches;
}

function displayLine(line) {
  return line.replace(/(?:\r\n|\n|\r)$/, '');
}

export function buildSourceComparison(leftSource, rightSource) {
  const leftLines = splitSourceLines(leftSource);
  const rightLines = splitSourceLines(rightSource);
  const sequence = buildSequenceHunks(leftLines, rightLines);
  const rows = [];
  let leftLineIndex = 0;
  let rightLineIndex = 0;
  let hunkIndex = 0;

  const pushEqualUntil = (leftTarget, rightTarget) => {
    while (leftLineIndex < leftTarget && rightLineIndex < rightTarget) {
      rows.push({
        hunkId: null,
        kind: 'same',
        leftLineNumber: leftLineIndex + 1,
        rightLineNumber: rightLineIndex + 1,
        leftText: displayLine(leftLines[leftLineIndex]),
        rightText: displayLine(rightLines[rightLineIndex]),
        leftParts: null,
        rightParts: null
      });
      leftLineIndex += 1;
      rightLineIndex += 1;
    }
  };

  for (const hunk of sequence.hunks) {
    pushEqualUntil(hunk.leftStart, hunk.rightStart);

    const leftSlice = leftLines.slice(hunk.leftStart, hunk.leftStart + hunk.leftCount);
    const rightSlice = rightLines.slice(hunk.rightStart, hunk.rightStart + hunk.rightCount);
    const rowCount = Math.max(leftSlice.length, rightSlice.length);

    for (let i = 0; i < rowCount; i += 1) {
      const leftLine = leftSlice[i] ?? null;
      const rightLine = rightSlice[i] ?? null;
      const leftText = leftLine === null ? '' : displayLine(leftLine);
      const rightText = rightLine === null ? '' : displayLine(rightLine);
      const details = leftLine !== null && rightLine !== null
        ? inlineParts(leftText, rightText)
        : null;

      rows.push({
        hunkId: hunk.id,
        hunkIndex,
        hunkFirstRow: i === 0,
        kind: hunk.kind,
        leftLineNumber: leftLine === null ? null : hunk.leftStart + i + 1,
        rightLineNumber: rightLine === null ? null : hunk.rightStart + i + 1,
        leftText,
        rightText,
        leftParts: details?.left ?? (leftLine === null ? [] : [{ text: leftText, changed: true }]),
        rightParts: details?.right ?? (rightLine === null ? [] : [{ text: rightText, changed: true }])
      });
    }

    leftLineIndex = hunk.leftStart + hunk.leftCount;
    rightLineIndex = hunk.rightStart + hunk.rightCount;
    hunkIndex += 1;
  }

  pushEqualUntil(leftLines.length, rightLines.length);

  while (leftLineIndex < leftLines.length) {
    rows.push({
      hunkId: null,
      kind: 'same',
      leftLineNumber: leftLineIndex + 1,
      rightLineNumber: null,
      leftText: displayLine(leftLines[leftLineIndex]),
      rightText: '',
      leftParts: null,
      rightParts: null
    });
    leftLineIndex += 1;
  }

  while (rightLineIndex < rightLines.length) {
    rows.push({
      hunkId: null,
      kind: 'same',
      leftLineNumber: null,
      rightLineNumber: rightLineIndex + 1,
      leftText: '',
      rightText: displayLine(rightLines[rightLineIndex]),
      leftParts: null,
      rightParts: null
    });
    rightLineIndex += 1;
  }

  return {
    hunks: sequence.hunks,
    rows,
    leftLineCount: leftLines.length,
    rightLineCount: rightLines.length
  };
}

export function buildCompareAnalysis(leftSource, rightSource) {
  return {
    visual: buildVisibleComparison(leftSource, rightSource),
    source: buildSourceComparison(leftSource, rightSource)
  };
}

export function mergeSourceHunk(leftSource, rightSource, hunkId, direction) {
  const analysis = buildSourceComparison(leftSource, rightSource);
  const hunk = analysis.hunks.find((candidate) => candidate.id === hunkId);
  if (!hunk) return { ok: false, reason: 'Difference no longer exists.' };

  const leftLines = splitSourceLines(leftSource);
  const rightLines = splitSourceLines(rightSource);

  if (direction === 'left-to-right') {
    const replacement = leftLines.slice(hunk.leftStart, hunk.leftStart + hunk.leftCount);
    rightLines.splice(hunk.rightStart, hunk.rightCount, ...replacement);
    return { ok: true, leftSource, rightSource: rightLines.join('') };
  }

  if (direction === 'right-to-left') {
    const replacement = rightLines.slice(hunk.rightStart, hunk.rightStart + hunk.rightCount);
    leftLines.splice(hunk.leftStart, hunk.leftCount, ...replacement);
    return { ok: true, leftSource: leftLines.join(''), rightSource };
  }

  return { ok: false, reason: 'Unknown merge direction.' };
}

export function mergeVisibleTextHunk(leftSource, rightSource, hunkId, direction) {
  const leftNodes = extractEditableTextNodes(leftSource);
  const rightNodes = extractEditableTextNodes(rightSource);
  const analysis = buildVisibleComparison(leftSource, rightSource);
  const hunk = analysis.hunks.find((candidate) => candidate.id === hunkId);

  if (!hunk) return { ok: false, reason: 'Difference no longer exists.' };
  if (!hunk.mergeableText) {
    return {
      ok: false,
      reason: 'This change adds/removes text blocks. Use Source view to merge structural changes.'
    };
  }

  const leftById = new Map(leftNodes.map((node) => [node.id, node]));
  const rightById = new Map(rightNodes.map((node) => [node.id, node]));

  if (direction === 'left-to-right') {
    const edits = {};
    for (let i = 0; i < hunk.leftNodeIds.length; i += 1) {
      const sourceNode = leftById.get(hunk.leftNodeIds[i]);
      const targetNode = rightById.get(hunk.rightNodeIds[i]);
      if (!sourceNode || !targetNode) continue;
      edits[targetNode.id] = sourceNode.text;
    }
    return {
      ok: true,
      leftSource,
      rightSource: applyTextEdits(rightSource, rightNodes, edits)
    };
  }

  if (direction === 'right-to-left') {
    const edits = {};
    for (let i = 0; i < hunk.rightNodeIds.length; i += 1) {
      const sourceNode = rightById.get(hunk.rightNodeIds[i]);
      const targetNode = leftById.get(hunk.leftNodeIds[i]);
      if (!sourceNode || !targetNode) continue;
      edits[targetNode.id] = sourceNode.text;
    }
    return {
      ok: true,
      leftSource: applyTextEdits(leftSource, leftNodes, edits),
      rightSource
    };
  }

  return { ok: false, reason: 'Unknown merge direction.' };
}
