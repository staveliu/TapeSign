#!/bin/sh
set -eu
cd /opt/tapesign-cache
if [ "$(id -u)" != 0 ]; then echo 'Run as root (sudo sh server/install.sh).' >&2; exit 1; fi
NODE_BINARY="${NODE_BINARY:-$(command -v node || true)}"
if [ -z "$NODE_BINARY" ] || [ ! -x "$NODE_BINARY" ]; then echo 'Install Node.js 20+ and set NODE_BINARY if needed.' >&2; exit 1; fi
"$NODE_BINARY" -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)'
test -f server/cache.bundle.mjs
test -f server/tapesign-cache.service
id tapesign-cache >/dev/null 2>&1 || useradd --system --home-dir /var/lib/tapesign-cache --shell /usr/sbin/nologin tapesign-cache
install -d -m 0755 /opt/tapesign-cache/bin
install -d -m 0700 -o tapesign-cache -g tapesign-cache /var/lib/tapesign-cache
if [ "$(readlink -f "$NODE_BINARY")" != /opt/tapesign-cache/bin/node ]; then
    install -m 0755 "$NODE_BINARY" /opt/tapesign-cache/bin/node
fi
install -m 0644 server/tapesign-cache.service /etc/systemd/system/tapesign-cache.service
systemctl daemon-reload
systemctl enable tapesign-cache.service
systemctl restart tapesign-cache.service
systemctl is-active tapesign-cache.service
