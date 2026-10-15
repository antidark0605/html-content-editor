import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInlineFormatting,
  applyTextEdits,
  buildEditableHtml,
  extractEditableTextNodes
} from '../src/html-model.mjs';

test('extracts visible text while skipping script and style content', () => {
  const source = `<!doctype html>
<html>
<head><style>.x { color: red; }</style></head>
<body>
  <h1 class="title">Hello <strong>world</strong></h1>
  <script>window.secret = "do not edit me";</script>
</body>
</html>`;

  const nodes = extractEditableTextNodes(source);
  assert.deepEqual(nodes.map((node) => node.text), ['Hello', 'world']);
});

test('applies only requested text replacements and escapes HTML metacharacters', () => {
  const source = '<p class="lead">Hello &amp; world</p>';
  const nodes = extractEditableTextNodes(source);

  assert.equal(nodes.length, 1);

  const updated = applyTextEdits(source, nodes, {
    [nodes[0].id]: 'A < B & C'
  });

  assert.equal(updated, '<p class="lead">A &lt; B &amp; C</p>');
  assert.match(updated, /class="lead"/);
});

test('supports separately editing text around nested formatting tags', () => {
  const source = '<h2>VoxCPM2 <strong>Streaming</strong> Architecture</h2>';
  const nodes = extractEditableTextNodes(source);

  assert.deepEqual(nodes.map((node) => node.text), ['VoxCPM2', 'Streaming', 'Architecture']);

  const updated = applyTextEdits(source, nodes, {
    [nodes[0].id]: 'Voice',
    [nodes[2].id]: 'Overview'
  });

  assert.equal(updated, '<h2>Voice <strong>Streaming</strong> Overview</h2>');
});

test('applies inline formatting to only the selected text range', () => {
  const source = '<p class="lead">Hello important world.</p>';
  const node = extractEditableTextNodes(source)[0];

  const updated = applyInlineFormatting(source, {
    nodeId: node.id,
    expectedText: node.text,
    start: 6,
    end: 15,
    format: 'bold'
  });

  assert.equal(
    updated,
    '<p class="lead">Hello <span style="font-weight: 700;">important</span> world.</p>'
  );
  assert.match(updated, /class="lead"/);
});

test('supports controlled size and color formatting', () => {
  const source = '<p>Alpha Beta</p>';
  const node = extractEditableTextNodes(source)[0];

  const sized = applyInlineFormatting(source, {
    nodeId: node.id,
    expectedText: node.text,
    start: 0,
    end: 5,
    format: 'fontSize',
    value: '20px'
  });

  const sizedNode = extractEditableTextNodes(sized).find((candidate) => candidate.text === 'Alpha');
  const colored = applyInlineFormatting(sized, {
    nodeId: sizedNode.id,
    expectedText: sizedNode.text,
    start: 0,
    end: 5,
    format: 'color',
    value: '#D32F2F'
  });

  assert.match(sized, /font-size: 20px/);
  assert.match(colored, /color: #d32f2f/);
});

test('rejects cross-node or stale formatting requests instead of guessing', () => {
  const source = '<p>Hello <strong>world</strong></p>';
  const node = extractEditableTextNodes(source)[0];

  assert.throws(() => applyInlineFormatting(source, {
    nodeId: node.id,
    expectedText: 'Different text',
    start: 0,
    end: 3,
    format: 'italic'
  }), /changed before formatting/);

  assert.throws(() => applyInlineFormatting(source, {
    nodeId: node.id,
    expectedText: node.text,
    start: 0,
    end: node.text.length + 10,
    format: 'underline'
  }), /range is no longer valid/);
});

test('editable rendering adds markers without changing the saved source', () => {
  const source = '<div><span class="red">Hello</span></div>';
  const nodes = extractEditableTextNodes(source);
  const rendered = buildEditableHtml(source, nodes, {});

  assert.match(rendered, /data-hce-id="text-1"/);
  assert.equal(applyTextEdits(source, nodes, {}), source);
});

test('removes a sole span wrapper when all of its text is deleted', () => {
  const source = '<p>Before <span class="boxed">Delete me</span> after</p>';
  const nodes = extractEditableTextNodes(source);
  const target = nodes.find((node) => node.text === 'Delete me');

  assert.equal(target.emptySpanDepth, 1);

  const updated = applyTextEdits(source, nodes, {
    [target.id]: ''
  });
  const rendered = buildEditableHtml(source, nodes, {
    [target.id]: ''
  });

  assert.equal(updated, '<p>Before  after</p>');
  assert.equal(rendered, '<p>Before  after</p>');
  assert.doesNotMatch(updated, /class="boxed"/);
});

test('keeps a span wrapper when it still contains other content', () => {
  const source = '<p><span class="boxed">Delete <strong>keep</strong></span></p>';
  const nodes = extractEditableTextNodes(source);
  const target = nodes.find((node) => node.text === 'Delete');

  assert.equal(target.emptySpanDepth, 0);

  const updated = applyTextEdits(source, nodes, {
    [target.id]: ''
  });

  assert.equal(updated, '<p><span class="boxed"> <strong>keep</strong></span></p>');
  assert.match(updated, /class="boxed"/);
});


test('compare utility math clamps zoom and maps proportional scrolling', async () => {
  const { clampZoom, scrollRatio, scrollTopForRatio } = await import('../src/compare-utils.mjs');

  assert.equal(clampZoom(0.1), 0.5);
  assert.equal(clampZoom(1.25), 1.25);
  assert.equal(clampZoom(9), 2);

  assert.equal(scrollRatio(450, 1200, 300), 0.5);
  assert.equal(scrollTopForRatio(0.5, 2200, 400), 900);
  assert.equal(scrollRatio(10, 200, 300), 0);
});
