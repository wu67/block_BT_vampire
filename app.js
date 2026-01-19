const dayjs = require('dayjs')
const $fetch = require('./fetch')
const config = {
  regeExp: /\w+/,
  rpcAddr: 'http://127.0.0.1:6800/jsonrpc', // aria2 rpc 地址
  secret: '123456', // aria2 rpc 密码
  block_keywords: ['XL', 'SD', 'XF', 'QD', 'BN', 'DL', 'TS', 'DT', 'GT'], // 要ban掉的客户端peer简称
  interval: 10000,
  saveSessionInterval: 3600000, // 自动保存会话. 避免机器重启导致aria2做种任务丢失.
  releaseTime: 3600000, // 若干毫秒后, 将ip移出屏蔽列表. 因为IP本身已加入自动过期的ipset中, 清除程序中的缓存可以稍微降低占用
  requestTimeout: 10000, // 请求超时时间
  maxFailCount: 5, // 最大连续失败次数
  circuitBreakerDuration: 60000, // 熔断器打开后的持续时间（1分钟）
}
// 其实依赖redis是最好的, 但是用来ban ip有点大材小用了, 就干脆用数组凑合, pm2每隔一个小时重启
const blockList = []

// 故障保护机制
let failCount = 0 // 连续失败次数
let circuitBreakerOpenUntil = 0 // 熔断器打开到何时

function decodePeerID(str) {
  // -qb1234-123456789012, peerid 总长20, 正规bt客户端以-(两位简称)(4位版本号)-开头, 其余无意义字符补齐20位,
  // 在aria2中会被编码过再返回, 其中-被编码为%2D, 退N步讲, 前8位会被编码为12位, 后12位极端情况下为纯数字不必编码, 最少为12位,
  // 故解码前的数据, 理论合法值不可能小于24位
  if (!str || str.length < 24) return ''

  // 所以不必解码所有peer id, 这操作本身无意义, 解码前12位即可
  return str.substring(0, 12).replace(/%2(d|D)/g, '-')
}

async function asyncProcessingEachItem(list, cb) {
  const length = list.length
  for (let i = 0; i < length; i++) {
    await cb(list[i])
  }
}

async function asyncBlockIP(ip, ua) {
  try {
    if (blockList.includes(ip)) {
      return
    }

    console.log(dayjs().format('YYYY-MM-DD HH:mm:ss') + ' block vampire: ', ip, ` ${ua}`)
    blockList.push(ip)

    if (ip.includes(':')) {
      await require('util').promisify(require('child_process').exec)(`ipset add vampire_v6 ${ip}`)
    } else {
      await require('util').promisify(require('child_process').exec)(`ipset add vampire_v4 ${ip}`)
    }
    releaseIP()
  } catch (e) {
    if (typeof e.stderr === 'string' && e.stderr.indexOf('already added') !== -1) {
      // do nothing
      console.log(`${ip} already added`)
    } else {
      throw e
    }
  }
}

function releaseIP() {
  setTimeout(() => {
    blockList.shift()
  }, config.releaseTime)
}

let isProcessing = false
async function cron() {
  // 检查熔断器状态
  const now = Date.now()
  if (circuitBreakerOpenUntil > now) {
    const remainingSeconds = Math.ceil((circuitBreakerOpenUntil - now) / 1000)
    console.log(`熔断器已打开，剩余 ${remainingSeconds} 秒后重试`)
    return
  }

  isProcessing = true
  try {
    const activeTaskList = await $fetch.post(
      config.rpcAddr,
      {
        jsonrpc: '2.0',
        method: 'aria2.tellActive',
        id: `${Math.random()}`,
        params: [`token:${config.secret}`, ['gid', 'status']],
      },
      { timeout: config.requestTimeout },
    )

    await asyncProcessingEachItem(activeTaskList.result, async (task) => {
      if (task.status !== 'active') return

      let peerList = await $fetch.post(
        config.rpcAddr,
        {
          jsonrpc: '2.0',
          method: 'system.multicall',
          id: `${Math.random()}`,
          params: [
            [
              {
                methodName: 'aria2.getPeers',
                params: [`token:${config.secret}`, task.gid],
              },
            ],
          ],
        },
        { timeout: config.requestTimeout },
      )
      await asyncProcessingEachItem(peerList.result[0][0], async (peer) => {
        const ua = decodePeerID(peer.peerId)
        console.log(peer.ip, ua, 'ua')
        // 有些奇葩设置peerid为奇奇怪怪的串, 直接ban掉, 很明显搞事的
        if (ua === '' || !/^(a2)?%(2d|00)/i.test(peer.peerId)) {
          await asyncBlockIP(peer.ip, peer.peerId)
        } else if (config.regExp.test(ua)) {
          await asyncBlockIP(peer.ip, ua)
        }
      })
    })

    // 请求成功，重置失败计数
    if (failCount > 0) {
      console.log(`连接恢复，重置失败计数（之前失败 ${failCount} 次）`)
      failCount = 0
    }
  } catch (e) {
    failCount++
    console.error(`请求失败（第 ${failCount} 次）:`, e.message || e)

    // 达到最大失败次数，打开熔断器
    if (failCount >= config.maxFailCount) {
      circuitBreakerOpenUntil = Date.now() + config.circuitBreakerDuration
      const duration = config.circuitBreakerDuration / 1000
      console.error(`⚠️  连续失败 ${failCount} 次，熔断器已打开，暂停 ${duration} 秒`)
      failCount = 0 // 重置计数，等待熔断器关闭后重新计数
    }
  } finally {
    // 确保 isProcessing 总是被重置
    isProcessing = false
  }
}

const saveSession = () => {
  console.log('save aria2 session')
  $fetch
    .post(
      config.rpcAddr,
      {
        jsonrpc: '2.0',
        method: 'aria2.saveSession',
        id: `${Math.random()}`,
        params: [`token:${config.secret}`, ['gid', 'status']],
      },
      { timeout: config.requestTimeout },
    )
    .catch((e) => {
      console.error('保存会话失败:', e.message || e)
    })
}

;(function () {
  console.log(dayjs().format('YYYY-MM-DD HH:mm:ss') + " Let's block vampire now")
  config.regExp = new RegExp('-(' + config.block_keywords.join('|') + ')')

  setInterval(() => {
    if (!isProcessing) {
      cron()
    }
  }, config.interval)
  cron()

  setInterval(() => {
    saveSession()
  }, config.saveSessionInterval)
  // saveSession()
})()
