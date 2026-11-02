const capabilityLabels = {
  tools: 'أدوات (Tools)',
  reasoning: 'استدلال (Reasoning)',
  json_mode: 'JSON',
  image_input: 'إدخال صور (Image Input)',
  image_output: 'إخراج صور (Image Output)',
  audio_input: 'إدخال صوت (Audio Input)',
  audio_output: 'إخراج صوت (Audio Output)',
  text: 'نص (Text)',
}

function safePrice(val) {
  if ((typeof val !== 'number' && typeof val !== 'string') || (typeof val === 'string' && !val.trim())) return null
  const p = Number(val)
  if (!Number.isFinite(p)) return null
  return p < 0 ? null : p
}

export function normalizeModels(raw) {
  const list = raw?.models ?? raw?.data ?? raw ?? []
  return (Array.isArray(list) ? list : []).map(m => {
    const prices = m.prices || {}
    const pricing = m.pricing || {}
    return {
      id: m.id,
      name: m.name || (m.id ? m.id.split('/').pop() : ''),
      provider: m.provider ?? (m.id ? m.id.split('/')[0] : null),
      description: m.description,
      prices: {
        input: safePrice(m.prices ? prices.input : pricing.prompt),
        output: safePrice(m.prices ? prices.output : pricing.completion),
        input_cache_read: safePrice(m.prices ? prices.input_cache_read : pricing.input_cache_read),
      },
      context_length: m.context_length,
      capabilities: [
        ...new Set([
          ...(m.capabilities || []),
          ...(m.architecture?.input_modalities || []).map(mode => mode === 'text' ? 'text' : `${mode}_input`),
          ...(m.architecture?.output_modalities || []).map(mode => mode === 'text' ? 'text' : `${mode}_output`),
          ...(m.supported_parameters || []).filter(parameter => ['tools', 'reasoning', 'json_mode'].includes(parameter)),
        ]),
      ],
    }
  })
}

export function filterByProvider(models, provider) {
  if (!provider) return models
  return models.filter(m => m.provider === provider)
}

export function filterByCapability(models, capability) {
  if (!capability) return models
  return models.filter(m => m.capabilities.includes(capability))
}

export function searchModels(models, query) {
  if (!query || !query.trim()) return models
  const q = query.trim().toLowerCase()
  return models.filter(m => [m.id, m.name, m.provider, m.description].some(value =>
    typeof value === 'string' && value.toLowerCase().includes(q)
  ))
}

export function sortByPrice(models, field, direction) {
  const dir = direction === 'desc' ? -1 : 1
  return [...models].sort((a, b) => {
    const pa = safePrice(a.prices?.[field])
    const pb = safePrice(b.prices?.[field])
    if (pa === null && pb === null) return 0
    if (pa === null) return 1
    if (pb === null) return -1
    return (pa - pb) * dir
  })
}

export function calculateCost(rate, inputTokens, outputTokens, inputCacheTokens) {
  const tokenCount = value => {
    if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) {
      throw new Error('Token counts must be finite nonnegative integers (0–1,000,000,000)')
    }
    const count = Number(value)
    if (!Number.isSafeInteger(count) || count < 0 || count > 1e9) {
      throw new Error('Token counts must be finite nonnegative integers (0–1,000,000,000)')
    }
    return count
  }
  inputTokens = tokenCount(inputTokens)
  outputTokens = tokenCount(outputTokens)
  inputCacheTokens = inputCacheTokens === undefined ? 0 : tokenCount(inputCacheTokens)
  const componentCost = (field, tokens) => {
    if (tokens === 0) return 0
    const price = safePrice(rate?.[field])
    if (price === null) throw new Error(`Unavailable rate: ${field}`)
    const cost = tokens * price
    if (!Number.isFinite(cost)) throw new Error('Cost must be finite')
    return cost
  }
  const inputCost = componentCost('input', inputTokens)
  const outputCost = componentCost('output', outputTokens)
  const inputCacheCost = componentCost('input_cache_read', inputCacheTokens ?? 0)
  const total = inputCost + outputCost + inputCacheCost
  if (!Number.isFinite(total)) throw new Error('Cost must be finite')
  return { inputCost, outputCost, inputCacheCost, total }
}

export function getCapabilityLabels() {
  return capabilityLabels
}

export function formatUsd(value) {
  const price = safePrice(value)
  if (price === null) return 'غير متاح'
  return `$${price > 0 && price < 0.000001 ? price.toExponential(6) : price.toFixed(6)}`
}

export function formatPricePerMillion(rate) {
  const price = safePrice(rate)
  return formatUsd(price === null ? null : price * 1e6)
}

export function getUniqueProviders(models) {
  return [...new Set(models.map(m => m.provider).filter(Boolean))].sort()
}

export function getUniqueCapabilities(models) {
  return [...new Set(models.flatMap(m => m.capabilities))].sort()
}

export function getCapabilityLabel(key) {
  return capabilityLabels[key] || key
}