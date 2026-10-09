function matchesType(value, type) {
  if (type === 'null') return value === null
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'integer') return Number.isInteger(value)
  return true
}

function validate(value, schema, path, errors) {
  if (!schema || typeof schema !== 'object') return
  if (Array.isArray(schema.oneOf) && !schema.oneOf.some((candidate) => {
    const branchErrors = []
    validate(value, candidate, path, branchErrors)
    return branchErrors.length === 0
  })) errors.push(`${path} no coincide con ninguna alternativa.`)
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path} debe ser ${schema.const}.`)
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} tiene un valor no permitido.`)
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(`${path} tiene un tipo inválido.`)
      return
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} es demasiado corto.`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} es demasiado largo.`)
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`, errors))
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) errors.push(`${path}.${required} es obligatorio.`)
    }
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) validate(value[key], child, `${path}.${key}`, errors)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties || {}, key)) errors.push(`${path}.${key} no está declarado.`)
      }
    }
  }
}

export function validateOutput(value, schema) {
  const errors = []
  validate(value, schema, '$', errors)
  return errors
}
