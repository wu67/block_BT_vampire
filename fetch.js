const $fetch = async function (path, p) {
  const timeout = p.timeout || 10000 // 默认 10 秒超时
  const config = {
    method: p.method || 'GET',
  }
  if (p.body) {
    config.body = JSON.stringify(p.body)
  }

  let q = ''
  if (p.query && Object.prototype.toString.call(p.query) === '[object Object]') {
    for (const key in p.query) {
      if (Object.getOwnPropertyNames(p.query).includes(key)) {
        q += `&${key}=${encodeURIComponent(p.query[key])}`
      }
    }
    if (q.length) q = q.substring(1)
  }

  if (p.headers) {
    config.headers = Object.assign(
      {
        'Content-Type': 'application/json',
      },
      p.headers,
    )
    const jsonREG = /pplication\/json/
    if (!jsonREG.test(p.headers['Content-Type'])) {
      config.body = p.body
    }
  } else {
    config.headers = {
      'Content-Type': 'application/json',
    }
  }

  let url = path
  if (q.length) {
    url += url.indexOf('?') === -1 ? `?${q}` : `&${q}`
  }

  // 添加超时控制
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  config.signal = controller.signal

  try {
    const res = await fetch(url, config)
    clearTimeout(timeoutId)

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`)
    }

    const result = await res.json()
    return result
  } catch (e) {
    clearTimeout(timeoutId)
    if (e.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms: ${url}`)
    }
    throw e
  }
}
const temp = {
  post: (path, data = {}, config = {}) => $fetch(path, { ...config, body: data, method: 'POST' }),

  get: (path, query = {}, config = {}) => $fetch(path, { ...config, query, method: 'GET' }),
}
module.exports = temp
