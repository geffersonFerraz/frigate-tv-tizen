const test = require('node:test');
const assert = require('node:assert');
const E = require('../app/js/events.js');

const review = (id, severity) => ({ id, camera: 'Kitchen', severity, start_time: 1, data: { objects: ['person'] } });

test('an alert is reported once: when new, or when a detection becomes an alert', () => {
  const got = [];
  E._reset(r => got.push(r.id));
  assert.strictEqual(E._handle({ type: 'new', after: review('a', 'alert') }), true);
  assert.strictEqual(E._handle({ type: 'update', before: review('a', 'alert'), after: review('a', 'alert') }), false);
  assert.strictEqual(E._handle({ type: 'new', after: review('b', 'detection') }), false);
  assert.strictEqual(E._handle({ type: 'update', before: review('b', 'detection'), after: review('b', 'alert') }), true);
  assert.strictEqual(E._handle({ type: 'end', before: review('c', 'alert'), after: review('c', 'alert') }), false);
  assert.deepStrictEqual(got, ['a', 'b']);
});
