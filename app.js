const axios = require('axios')
const dayjs = require('dayjs')

const config = {
  regeExp: /\w+/,
  rpcAddr: 'http://127.0.0.1:6800/jsonrpc', // aria2 rpc 地址
  secret: '123456', // aria2 rpc 密码
  block_keywords: ['XL', 'SD', 'XF', 'QD', 'BN', 'DL', 'TS', 'DT', 'GT'], // 要ban掉的客户端peer简称
  interval: 10000,
  releaseTime: 3600000, // 若干毫秒后, 将ip移出屏蔽列表. 因为IP本身已加入自动过期的ipset中, 清除程序中的缓存可以稍微降低占用
}
// 其实依赖redis是最好的, 但是用来ban ip有点大材小用了, 就干脆用数组凑合, pm2每隔一个小时重启
const blockList = []

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

    console.log(
      dayjs().format('YYYY-MM-DD HH:mm:ss') + ' block vampire: ',
      ip,
      ` ${ua}`
    )
    blockList.push(ip)

    if (ip.includes(':')) {
      await require('util').promisify(require('child_process').exec)(
        `ipset add vampire_v6 ${ip}`
      )
    } else {
      await require('util').promisify(require('child_process').exec)(
        `ipset add vampire_v4 ${ip}`
      )
    }
    releaseIP()
  } catch (e) {
    if (
      typeof e.stderr === 'string' &&
      e.stderr.indexOf('already added') !== -1
    ) {
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
  isProcessing = true
  try {
    const activeTaskList = await axios.post(config.rpcAddr, {
      jsonrpc: '2.0',
      method: 'aria2.tellActive',
      id: `${Math.random()}`,
      params: [`token:${config.secret}`, ['gid', 'status']],
    })

    await asyncProcessingEachItem(activeTaskList.data.result, async (task) => {
      if (task.status !== 'active') return

      let peerList = await axios.post(config.rpcAddr, {
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
      })

      await asyncProcessingEachItem(
        peerList.data.result[0][0],
        async (peer) => {
          const ua = decodePeerID(peer.peerId)
          // console.log(ua, 'ua')
          // 有些奇葩设置peerid为奇奇怪怪的串, 直接ban掉, 很明显搞事的
          if (ua === '' || !/^(a2)?%(2d|00)/i.test(peer.peerId)) {
            await asyncBlockIP(peer.ip, peer.peerId)
          } else if (config.regExp.test(ua)) {
            await asyncBlockIP(peer.ip, ua)
          }
        }
      )
    })
  } catch (e) {
    console.error(e)
  }
  isProcessing = false
}

;(function () {
  console.log(
    dayjs().format('YYYY-MM-DD HH:mm:ss') + " Let's block vampire now"
  )
  config.regExp = new RegExp('-(' + config.block_keywords.join('|') + ')')

  setInterval(() => {
    if (!isProcessing) {
      cron()
    }
  }, config.interval)
  cron()
})()
