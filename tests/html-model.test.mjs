import test from 'node:test';
import assert from 'node:assert/strict';
import {
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

test('editable rendering adds markers without changing the saved source', () => {
  const source = '<div><span class="red">Hello</span></div>';
  const nodes = extractEditableTextNodes(source);
  const rendered = buildEditableHtml(source, nodes, {});

  assert.match(rendered, /data-hce-id="text-1"/);
  assert.equal(applyTextEdits(source, nodes, {}), source);
});
