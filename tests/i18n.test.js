const test = require('node:test');
const assert = require('node:assert');
const I18n = require('../app/js/i18n.js');

test('every language has the same keys as English', () => {
  const en = Object.keys(I18n._strings.en).sort();
  for (const code of Object.keys(I18n._strings)) {
    assert.deepStrictEqual(Object.keys(I18n._strings[code]).sort(), en, code);
  }
});

test('placeholders match English in every language', () => {
  const holes = s => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const code of Object.keys(I18n._strings)) {
    for (const [key, s] of Object.entries(I18n._strings.en)) {
      assert.strictEqual(holes(I18n._strings[code][key]), holes(s), `${code} ${key}`);
    }
  }
});

test('English is the default; t() fills placeholders; labels and dates follow the language', () => {
  assert.strictEqual(I18n.lang(), 'en');
  assert.strictEqual(I18n.t('live.waiting', { name: 'Garage' }), 'Waiting for video from Garage…');
  assert.strictEqual(I18n.label('license_plate'), 'license plate');
  const d = new Date(2026, 10, 3);
  assert.strictEqual(I18n.date(d), 'Tue, Nov 3');
  I18n.set('es');
  assert.strictEqual(I18n.label('dog'), 'perro');
  assert.strictEqual(I18n.date(d), 'mar. 3 de nov.');
  I18n.set('pt');
  assert.strictEqual(I18n.t('rec.events', { n: 4 }), '4 eventos');
  I18n.set('xx');
  assert.strictEqual(I18n.lang(), 'pt');
});
