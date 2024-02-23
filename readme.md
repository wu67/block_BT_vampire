# Block BT vampire

Block BT vampire by ipset iptables/ip6tables, just for `aria2 rpc mode`

通过 ipset iptables/ip6tables 屏蔽掉部分 BT 吸血客户端, 仅适用于 `aria2 rpc 模式`

## 使用

- config rpc secret in app.js #line 7 , secret should same with your aria2.conf file, like: rpc-secret=balabala, you should type `balabala` in line#7
- install ipset iptable ip6table
- install node.js
- config a base rule of iptables & ipset
- run with pm2

先更改 app.js 第 7 行的 aria2 密码, 如果 aria2 运行在非 6800 端口, 注意修改第 6 行的 rpc 地址.

接下来以 Debian 为例:

1. 安装 ipset

```bash
apt install ipset
```

2. 安装 iptable

```bash
apt install iptables ip6tables
```

3. 创建 ipset 集合, 3600 是一小时, 即自动过期时间

```bash
ipset create vampire_v4 hash:ip timeout 3600

ipset create vampire_v6 hash:ip family inet6 timeout 3600
```

4. iptable 封禁对应集合的 ip, 这里只封了高位端口, 避免把自己 IP 给封了导致无法 ssh 登录服务器.(ipv4 耗尽的地区的网络, 会有多人共用公共出口的 ipv4, 很可能你的邻居就在用吸血客户端...)

```bash
iptables -I INPUT -j DROP -p tcp --dport 9999:65535 -m set --match-set vampire_v4 src

ip6tables -I INPUT -j DROP -p tcp --dport 9999:65535 -m set --match-set vampire_v6 src
```

注: 这样配置在机器重启后就会丢失. 我是用 systemctl 启动了开机初始化服务, 这里仅介绍了如果用最简单的方法跑通, 数据持久化请自行处理.

5. 安装 node.js

自行处理 [https://nodejs.org/en/download/](https://nodejs.org/en/download/)

6. 安装 pm2 并启动

```bash
# 先cd到对应目录

# 然后安装pm2
npm i -g pm2

# pm2 启动
pm2 start app.js
```
