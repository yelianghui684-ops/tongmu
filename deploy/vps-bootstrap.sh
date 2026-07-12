#!/usr/bin/env bash
# 同幕 VPS 引导脚本 —— Ubuntu 22.04/24.04（为 Oracle Always Free 1C1G 机型设计），幂等可重跑。
# 用法：ssh 进服务器后  bash vps-bootstrap.sh
set -euo pipefail

echo '== 1/3 配置 2GB swap（1GB 内存机型构建镜像必需）=='
if ! sudo swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo '   swap 已启用'
else
  echo '   swap 已存在，跳过'
fi

echo '== 2/3 安装 Docker + compose 插件 =='
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo '   Docker 已安装（重新登录后 docker 命令免 sudo）'
else
  echo '   Docker 已存在，跳过'
fi

echo '== 3/3 放行本机防火墙端口 =='
# Oracle 的 Ubuntu 镜像自带 iptables 规则：除 22 外全部 REJECT。
# 只在云控制台安全组放行是不够的，这里必须同步放行。
open_port() { # $1=协议 $2=端口或范围(如 49160:49200)
  if ! sudo iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 5 -p "$1" --dport "$2" -j ACCEPT
    echo "   放行 $1/$2"
  else
    echo "   $1/$2 已放行，跳过"
  fi
}
open_port tcp 80
open_port tcp 443
open_port tcp 3478
open_port udp 3478
open_port udp 49160:49200

# 持久化规则（Oracle 镜像通常自带 netfilter-persistent；没有则装一个）
if ! command -v netfilter-persistent >/dev/null 2>&1; then
  echo iptables-persistent iptables-persistent/autosave_v4 boolean true | sudo debconf-set-selections
  echo iptables-persistent iptables-persistent/autosave_v6 boolean true | sudo debconf-set-selections
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null
fi
sudo netfilter-persistent save >/dev/null
echo '   规则已持久化'

echo
echo '✅ 引导完成。接下来：'
echo '   git clone <仓库地址> tongmu && cd tongmu/deploy'
echo '   cp .env.example .env  # 填 DOMAIN / TURN_HOST / TURN_SECRET'
echo '   docker compose up -d --build'
