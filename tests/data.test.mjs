import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBoard } from '../src/data.mjs'

test('preserves every server column and task without inventing statuses', () => {
  const task = { id: 'test-1', title: 'اختبار', status: 'review', assignee: 'worker' }
  const input = { columns: [{ name: 'review', tasks: [task] }, { name: 'future-state', tasks: [] }], now: 42 }
  assert.deepEqual(normalizeBoard(input), input)
})

test('rejects missing or malformed responses instead of showing a false empty board', () => {
  for (const input of [null, {}, { columns: {} }, { columns: [{ name: 'running', tasks: null }] }]) {
    assert.throws(() => normalizeBoard(input), /بيانات/)
  }
})
