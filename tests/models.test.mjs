import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeModels, calculateCost, filterByProvider, filterByCapability, searchModels, sortByPrice, formatUsd, formatPricePerMillion } from '../src/models.mjs'

const FIXTURE = [
  { id: 'openai/gpt-4', name: 'GPT-4', provider: 'openai', prices: { input: 0.03, output: 0.06, input_cache_read: 0.015 }, context_length: 8192, description: 'Advanced model', capabilities: ['tools', 'json_mode'] },
  { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus', provider: 'anthropic', prices: { input: 0.015, output: 0.075, input_cache_read: 0.0075 }, context_length: 200000, description: null, capabilities: ['tools', 'reasoning'] },
  { id: 'google/gemini-pro', name: 'Gemini Pro', provider: 'google', prices: { input: null, output: null, input_cache_read: null }, context_length: 30720, description: null, capabilities: [] },
  { id: 'meta/llama-3-70b', name: 'Llama 3 70B', provider: 'meta', prices: { input: 0.002, output: 0.002, input_cache_read: 0.001 }, context_length: 8192, description: 'Open model', capabilities: [] },
]

test('normalizeModels consumes backend models without losing rates, provider or capabilities', () => {
  const model = { ...FIXTURE[0], provider: 'published-provider', capabilities: ['image_input', 'tools', 'reasoning'] }
  assert.deepEqual(normalizeModels({ models: [model] }), [model])
  assert.deepEqual(normalizeModels([model]), [model])
  assert.equal(filterByCapability(normalizeModels([model]), 'image_output').length, 0)
})

test('normalizeModels transforms raw OpenRouter data', () => {
  const raw = { data: [
    { id: 'openai/gpt-4', name: 'GPT-4', description: 'Advanced model', pricing: { prompt: '0.03', completion: '0.06', input_cache_read: '0.015' }, context_length: 8192, architecture: { modality: 'text->text' } },
  ]}
  const result = normalizeModels(raw)
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'openai/gpt-4')
  assert.equal(result[0].prices.input, 0.03)
  assert.equal(result[0].prices.output, 0.06)
  assert.equal(result[0].prices.input_cache_read, 0.015)
  assert.equal(result[0].context_length, 8192)
  assert.equal(result[0].provider, 'openai')
})

test('normalizeModels handles missing pricing gracefully', () => {
  const raw = { data: [{ id: 'x/y', name: 'Y', pricing: {}, context_length: 1000 }] }
  const result = normalizeModels(raw)
  assert.equal(result[0].prices.input, null)
  assert.equal(result[0].prices.output, null)
})

test('normalizeModels treats negative prices as null', () => {
  const raw = { data: [{ id: 'x/y', name: 'Y', pricing: { prompt: '-1', completion: '-5' }, context_length: 1000 }] }
  const result = normalizeModels(raw)
  assert.equal(result[0].prices.input, null)
  assert.equal(result[0].prices.output, null)
})

test('normalizeModels preserves zero prices', () => {
  const raw = { data: [{ id: 'x/free', name: 'Free', pricing: { prompt: '0', completion: '0' }, context_length: 1000 }] }
  const result = normalizeModels(raw)
  assert.equal(result[0].prices.input, 0)
  assert.equal(result[0].prices.output, 0)
})

test('calculateCost returns correct totals', () => {
  const rate = { input: 0.01, output: 0.03 }
  const result = calculateCost(rate, 1, 1)
  assert.equal(result.inputCost, 0.01)
  assert.equal(result.outputCost, 0.03)
  assert.equal(result.total, 0.04)
})

test('calculateCost accepts optional input cache rate', () => {
  const rate = { input: 0.01, output: 0.03, input_cache_read: 0.005 }
  const result = calculateCost(rate, 1, 1, 1)
  assert.equal(result.inputCost, 0.01)
  assert.equal(result.outputCost, 0.03)
  assert.equal(result.inputCacheCost, 0.005)
  assert.ok(Math.abs(result.total - 0.045) < 0.0001)
})

test('calculateCost rejects negative token counts', () => {
  assert.throws(() => calculateCost({ input: 0.01, output: 0.03 }, -1, 0))
  assert.throws(() => calculateCost({ input: 0.01, output: 0.03 }, 0, -1))
})

test('calculateCost rejects NaN or Infinity', () => {
  assert.throws(() => calculateCost({ input: 0.01, output: 0.03 }, NaN, 0))
  assert.throws(() => calculateCost({ input: 0.01, output: 0.03 }, Infinity, 0))
})



test('calculateCost never treats unavailable rates as free for used tokens', () => {
  for (const invalid of [null, undefined, '', ' ', false, true, [], {}, NaN, Infinity, -1]) {
    assert.throws(() => calculateCost({ input: invalid, output: 0 }, 1, 0), /rate/i)
    assert.throws(() => calculateCost({ input: 0, output: invalid }, 0, 1), /rate/i)
    assert.throws(() => calculateCost({ input: 0, output: 0, input_cache_read: invalid }, 0, 0, 1), /rate/i)
    assert.equal(normalizeModels([{ id: 'x/y', prices: { input: invalid } }])[0].prices.input, null)
  }
  assert.equal(calculateCost({}, 0, 0).total, 0)
  assert.equal(calculateCost({ input: 0, output: 0, input_cache_read: 0 }, 100, 100, 100).total, 0)
})

test('calculateCost rejects blank, coerced or fractional counts in every field', () => {
  const rates = { input: 1, output: 1, input_cache_read: 1 }
  for (const invalid of ['', ' ', null, false, true, [], {}, 0.5, '1.2', 'NaN', -1, Infinity, 1e9 + 1]) {
    for (const index of [0, 1, 2]) {
      const counts = [0, 0, 0]
      counts[index] = invalid
      assert.throws(() => calculateCost(rates, ...counts), /count/i, `${index}: ${String(invalid)}`)
    }
  }
  assert.equal(calculateCost(rates, '2', '3', '4').total, 9)
  assert.throws(() => calculateCost(rates, undefined, 0), /count/i)
  assert.throws(() => calculateCost({ input: Number.MAX_VALUE }, 2, 0), /finite/i)
})

test('filterByProvider filters correctly', () => {
  const result = filterByProvider(FIXTURE, 'openai')
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'openai/gpt-4')
})

test('filterByProvider with null returns all', () => {
  assert.equal(filterByProvider(FIXTURE, null).length, 4)
})

test('filterByCapability filters correctly', () => {
  const result = filterByCapability(FIXTURE, 'tools')
  assert.equal(result.length, 2)
  assert.ok(result.some(m => m.id === 'openai/gpt-4'))
  assert.ok(result.some(m => m.id === 'anthropic/claude-3-opus'))
})

test('filterByCapability with empty returns all', () => {
  assert.equal(filterByCapability(FIXTURE, '').length, 4)
})

test('searchModels matches id and name', () => {
  const result = searchModels(FIXTURE, 'gpt')
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'openai/gpt-4')
})

test('searchModels is case-insensitive', () => {
  assert.equal(searchModels(FIXTURE, 'CLAUDE').length, 1)
})

test('sortByPrice ascending input price', () => {
  const sorted = sortByPrice(FIXTURE, 'input', 'asc')
  assert.equal(sorted[0].id, 'meta/llama-3-70b')
})

test('sortByPrice descending output price', () => {
  const sorted = sortByPrice(FIXTURE, 'output', 'desc')
  assert.equal(sorted[0].id, 'anthropic/claude-3-opus')
})

test('price display converts per-token rates to USD per million without rounding positive costs to zero', () => {
  assert.equal(formatPricePerMillion(0.000002), '$2.000000')
  assert.equal(formatPricePerMillion(0), '$0.000000')
  for (const invalid of [null, undefined, NaN, Infinity, '', false, -1]) {
    assert.equal(formatPricePerMillion(invalid), 'غير متاح')
    assert.equal(formatUsd(invalid), 'غير متاح')
  }
  assert.notEqual(formatUsd(0.00000001), '$0.000000')
  assert.equal(formatUsd(0.25), '$0.250000')
})

test('raw modalities remain direction-specific and never infer image generation', () => {
  const [model] = normalizeModels({ data: [{ id: 'x/y', architecture: { input_modalities: ['text', 'image', 'audio'], output_modalities: ['text'] }, supported_parameters: ['tools', 'reasoning'] }] })
  assert.ok(model.capabilities.includes('image_input'))
  assert.ok(model.capabilities.includes('audio_input'))
  assert.ok(model.capabilities.includes('reasoning'))
  assert.equal(model.capabilities.includes('image_output'), false)
  assert.equal(model.capabilities.includes('audio_output'), false)
})

test('search matches mixed-case identifiers, providers and factual descriptions', () => {
  const models = [{ id: 'Provider/ABC', name: 'Name', provider: 'Provider', description: 'Published translation support' }]
  for (const query of ['abc', 'provider', 'translation']) assert.equal(searchModels(models, query).length, 1)
})

test('unknown rates remain last in both sort directions with stable ties', () => {
  const models = [
    {id:'unknown-1', prices:{input:NaN}}, {id:'known', prices:{input:0}}, {id:'unknown-2', prices:{input:null}},
  ]
  for (const direction of ['asc', 'desc']) {
    assert.deepEqual(sortByPrice(models, 'input', direction).map(m => m.id), ['known', 'unknown-1', 'unknown-2'])
  }
  assert.equal(models[0].id, 'unknown-1')
})

test('models with null prices sort to end', () => {
  const sorted = sortByPrice(FIXTURE, 'input', 'asc')
  assert.equal(sorted[sorted.length - 1].id, 'google/gemini-pro')
})