import test from 'node:test'
import assert from 'node:assert/strict'
import { connectionError } from '../src/connection-error.mjs'
test('classifies native bridge failures without disclosing arbitrary content', () => {
 assert.match(connectionError(new Error('404: private body secret')), /404/)
 assert.match(connectionError(new Error('503: Auth provider nous unreachable')), /المصادقة/)
 assert.match(connectionError(new Error('401: Bearer super-secret')), /401/)
 assert.match(connectionError(new Error('Invalid execution history response')), /صيغة/)
 assert.match(connectionError(new Error('Gateway selection changed')), /تغيّر/)
 assert.match(connectionError(new Error('timeout secret')), /مهلة/)
 assert.doesNotMatch(connectionError(new Error('Bearer super-secret')), /super-secret/)
})
