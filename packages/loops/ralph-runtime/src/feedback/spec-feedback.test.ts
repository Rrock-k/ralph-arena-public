import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractCurrentFeedbackItems,
  getWorkRequiredFeedbackItems,
} from './spec-feedback.js';

test('extracts Sushi-style reopened BUG-005 with current Actual text', () => {
  const markdown = [
    '## Product Spec',
    '',
    '### Gameplay',
    'The restaurant should keep the customer queue readable.',
    '',
    '## Implementation Gaps',
    '',
    '### Open',
    '',
    '- BUG-005 (reopened#1): Customer queue/card readability',
    '  - Summary: Queue still overwhelms the small screen after the first fix.',
    '  - Expected: show at most 5-6 visible clients, keep cards readable, and keep urgent/VIP clients near the front.',
    '  - Actual: clients simultaneously too many; cards are cramped; urgent/VIP clients are too far away.',
    '  - Resolve when: customer count and priority ordering are visibly under control.',
    '',
    '### Done',
    '- Пока нет закрытых implementation gaps.',
  ].join('\n');

  const [item] = extractCurrentFeedbackItems(markdown, {
    specFile: 'spec.md',
    specHash: 'spec-hash-1',
  });

  assert.equal(item.id, 'BUG-005');
  assert.equal(item.status, 'reopened#1');
  assert.equal(item.specFile, 'spec.md');
  assert.equal(item.specHash, 'spec-hash-1');
  assert.equal(item.title, 'Customer queue/card readability');
  assert.match(item.expected ?? '', /5-6 visible clients/);
  assert.match(item.actual ?? '', /clients simultaneously too many/);
  assert.match(item.actual ?? '', /urgent\/VIP clients are too far away/);
  assert.equal(item.itemTextHash.length, 16);
  assert.deepEqual(item.sectionPath, ['Implementation Gaps', 'Open']);
});

test('extracts opened BUG-009 and BUG-010 as separate rows', () => {
  const markdown = [
    '## Product Spec',
    'Sushi game.',
    '',
    '## Implementation Gaps',
    '### Open',
    '- BUG-009: Timer does not match the accepted pacing',
    '  - Status: opened',
    '  - Expected: timer starts after first customer action.',
    '  - Actual: timer starts immediately on page load.',
    '- BUG-010: Mobile tray controls are hard to tap',
    '  - Status: open',
    '  - Expected: tray controls are large enough on phones.',
    '  - Actual: buttons are cramped near the screen edge.',
    '### Done',
    '- Пока нет закрытых implementation gaps.',
  ].join('\n');

  const items = extractCurrentFeedbackItems(markdown);

  assert.deepEqual(items.map((item) => item.id), ['BUG-009', 'BUG-010']);
  assert.deepEqual(items.map((item) => item.status), ['open', 'open']);
  assert.match(items[0].actual ?? '', /page load/);
  assert.match(items[1].expected ?? '', /phones/);
});

test('extracts Done items as closed without marking them work-required', () => {
  const markdown = [
    '## Implementation Gaps',
    '### Open',
    '- BUG-011: Remaining payment feedback',
    '  - Expected: payment feedback is clear.',
    '  - Actual: success and failure look similar.',
    '### Done',
    '- BUG-004: Menu cards used stale product names',
    '  - Expected: menu cards use accepted product names.',
    '  - Actual: fixed after spec v21.',
  ].join('\n');

  const items = extractCurrentFeedbackItems(markdown);
  const closedItem = items.find((item) => item.id === 'BUG-004');

  assert.equal(closedItem?.status, 'closed');
  assert.deepEqual(
    getWorkRequiredFeedbackItems(items).map((item) => item.id),
    ['BUG-011'],
  );
});

test('extracts visible BUG headings when Implementation Gaps is absent', () => {
  const markdown = [
    '# Review Notes',
    '',
    '## BUG-012: Score panel clips on mobile',
    'Expected: score panel fits in one row.',
    'Actual: score panel clips at 390px width.',
  ].join('\n');

  const [item] = extractCurrentFeedbackItems(markdown);

  assert.equal(item.id, 'BUG-012');
  assert.equal(item.status, 'unknown');
  assert.equal(item.title, 'Score panel clips on mobile');
  assert.match(item.actual ?? '', /390px/);
});

test('does not duplicate BUG entries from a table of contents', () => {
  const markdown = [
    '## Implementation Gaps',
    '',
    '### Contents',
    '- [BUG-005](#bug-005-customer-queuecard-readability)',
    '',
    '### Open',
    '- BUG-005: Customer queue/card readability',
    '  - Expected: readable customer cards.',
    '  - Actual: customer cards are cramped.',
    '',
    '### Done',
    '- Пока нет закрытых implementation gaps.',
  ].join('\n');

  const items = extractCurrentFeedbackItems(markdown);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'BUG-005');
  assert.equal(items[0].status, 'open');
  assert.match(items[0].actual ?? '', /cramped/);
});
