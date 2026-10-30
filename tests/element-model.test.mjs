import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteHtmlElement, listDeletableElementAncestors } from '../src/element-model.mjs';
import { extractEditableTextNodes } from '../src/html-model.mjs';

function candidate(source, targetText, tag) {
  const node = extractEditableTextNodes(source).find((item) => item.text === targetText);
  assert.ok(node, `Missing editable text ${targetText}`);
  const ancestors = listDeletableElementAncestors(source, node.id);
  const element = ancestors.find((item) => item.tag === tag);
  assert.ok(element, `Missing <${tag}> ancestor`);
  return { textNodeId: node.id, key: element.key };
}

test('deletes a full heading including nested styled text, preserving neighbors', () => {
  const html = '<section><h2 class="title"><span>Review資料</span></h2><p>Retain this</p></section>';
  const updated = deleteHtmlElement(html, candidate(html, 'Review資料', 'h2'));
  assert.equal(updated, '<section><p>Retain this</p></section>');
});

test('deletes one list item including links and markup, not siblings', () => {
  const html = '<ul><li><a href="a.html">First</a><em>!</em></li><li><a href="b.html">Second</a></li></ul>';
  const updated = deleteHtmlElement(html, candidate(html, 'First', 'li'));
  assert.equal(updated, '<ul><li><a href="b.html">Second</a></li></ul>');
});

test('can choose outer list to delete multiple child elements', () => {
  const html = '<h2>Links</h2>\n<ul><li>One</li><li>Two</li></ul>\n<p>Keep</p>';
  const updated = deleteHtmlElement(html, candidate(html, 'One', 'ul'));
  assert.equal(updated, '<h2>Links</h2>\n\n<p>Keep</p>');
});

test('only edits exact element source range and rejects stale or unsafe targets', () => {
  const html = '<style>.title{color:red}</style><!--keep--><main><h2 class="title">Hello</h2><p>Remain</p></main>';
  const choice = candidate(html, 'Hello', 'h2');
  assert.equal(
    deleteHtmlElement(html, choice),
    '<style>.title{color:red}</style><!--keep--><main><p>Remain</p></main>'
  );
  assert.throws(
    () => deleteHtmlElement(html.replace('Hello', 'Hello again'), choice),
    /Select it again/
  );
  const textId = extractEditableTextNodes(html).find((node) => node.text === 'Hello').id;
  assert.equal(listDeletableElementAncestors(html, textId).some((item) => item.tag === 'main'), false);
  assert.throws(() => deleteHtmlElement(html, { textNodeId: textId, key: 'body:0:999' }), /Select it again/);
});
