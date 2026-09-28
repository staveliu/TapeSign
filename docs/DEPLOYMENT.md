# 部署指南

## 静态客户端

构建环境需要 Node.js 22.12+。先审阅 [配置](CONFIGURATION.md)：

~~~sh
npm ci
npm test
npm run build
~~~

部署整个 dist/，包括 index.html、assets/、client-<release>.html 和 release.json，保持相对目录。页面本身是静态客户端；合同的缓存加速为可选，**当前公证发布则需要可用的缓存服务完成发布前查重与后台核验**。开源默认 `cacheOrigin` 为空，完整启用两项功能前应配置下文的缓存服务并重新构建。本地开发服务只监听回环地址，不能作为公网生产服务器。

构建同时生成 .local/TapeSign-<release>-standalone.html。通过本地 HTTP 服务打开独立副本；钱包可能不允许 file://。保留可信版本清单，核验链原件仍需可用 RPC。

npm run package 将源码、文档、配置、静态产物与校验清单整理到 release/。运行前先构建；打包检查不能替代人工检查最终产物，尤其是曾经配置过密钥的本地构建。

## 发布到 TapeOut

1. 确认目标容器已开通且连接其持有人钱包。链上文件上传不要求网站订阅；官方网关展示网站另需有效订阅。
2. npm run build 后运行 npm run dev，打开 http://127.0.0.1:18740/publish.html。
3. 连接 4.2.204 持有人钱包，点击“核验容器与发布计划”，核对目标、费用、版本、大小及交易数。
4. 上传并由钱包逐笔确认。中断后再次上传会核对待确认交易及链上文件前缀，只续传缺少的分块。
5. 点击“核验最终发布”，从最终确认区块回读文件，校验大小、字节及 SHA-256。

资源与版本入口先上传，首页最后切换。同名版本文件字节不同会停止；首页替换需单独确认。不要清除待确认状态来盲目重发。

npm run build 不发交易；发布工作台依赖本地 API，不在公开 dist/ 中。版本文件名并非链上只读权限，独立可信清单仍应另存。

发布工作台分别展示容器身份与网站订阅状态。网站订阅未生效时，仍可上传、续传并最终回读文件，但不能宣称官方网关已经可访问。为其他域名付费且容器级记录有效也算激活；较旧的域名付费记录可先核对 DomainBinding.syncContainer，再决定是否需要续费。订阅读取失败、代码变化、持有人异常或 RPC 分歧不会被忽略。

## 激活网站订阅

文件已通过最终回读核验后，不需要重新构建或上传。打开发布工作台里的“核对并激活网站”，或本地 `http://127.0.0.1:18740/activate.html`。

1. 页面从两个独立 RPC 核对 X Layer（196）上的容器持有人、合约代码、订阅状态及 `monthlyFee()`。已生效时禁用付款按钮。
2. 如果以前给同一容器的其他域名付过费，输入原完整域名，点“重新核对状态与费用”。存在未过期记录时，可点“核对并同步已有付费”，调用 `syncContainer(domain, container)`；订阅费为零，钱包仍需支付 gas。
3. 若没有有效记录，选择开通时长，点“钱包确认开通”，连接该容器持有人钱包。页面调用 `bind(name, container, months)`，金额为实时月费乘以期数，另加 gas；每期 30 天，以页面和钱包报价为准。
4. 钱包提交后页面每 10 秒重新查询，不保证 RPC 或最终确认在固定时间完成。出现“网站订阅已生效”后打开网站；网关仍显示旧状态时稍后刷新。

页面在广播前保存待确认意图，提交后保存交易哈希，刷新和多标签页不会自动再次付款。拒绝钱包确认可以重新核对；钱包断开且没有返回哈希时，先检查钱包活动与链上状态，不要清除浏览器待确认记录后盲目重发。已提交交易只有在最终确认后才结束待确认状态。

激活页仅由本地开发服务提供，使用浏览器钱包签署；不收集私钥，不改变已经发布的合同客户端。费用不是写死在源码里的价格。

## 本地缓存服务

~~~sh
npm run build:cache
HOST=127.0.0.1 PORT=18741 TAPESIGN_CACHE_DIR=./.local/cache node server/cache.bundle.mjs
~~~

PowerShell：

~~~powershell
$env:HOST = '127.0.0.1'
$env:PORT = '18741'
$env:TAPESIGN_CACHE_DIR = './.local/cache'
node server/cache.bundle.mjs
~~~

访问 http://127.0.0.1:18741/health。构建需 Node.js 22.12+，生成的自包含服务以 Node.js 20 为目标；新部署建议使用与构建一致的版本。服务不需要钱包密钥。

合同首次扫描不重放全链历史。已知旧合同可通过 POST /notify 提交 chainId 与 tx 定位，经核验后进入索引。公证则独立扫描两条支持链的公共公证信箱，并持久保存已核验证据与透明原件；非透明模式仅保存声明元数据，不接收原件。

公证使用 `GET /notary/check` 查重、`POST /notary/submit` 提交签名预览和交易定位，后台持久队列继续链上核验；另提供 `GET /notary/list`、`GET /notary/transaction/:chain/:tx` 和 `POST /notary/notify`。已核验记录、未核验预览及队列分开存储，具体字段见 [公证说明](NOTARY.md)。

另开终端，将 TAPESIGN_CACHE_ORIGIN 设为 http://127.0.0.1:18741，然后 npm run dev，即可通过同源 /cache 使用本地缓存。

## Linux / systemd

将 server/cache.bundle.mjs、server/install.sh 和 server/tapesign-cache.service 复制到服务器 /opt/tapesign-cache，保留目录结构。预先安装 Node.js 20+，建议 22.12+：

~~~sh
cd /opt/tapesign-cache
sudo sh server/install.sh
sudo systemctl status tapesign-cache
curl --fail http://127.0.0.1:18741/health
~~~

安装脚本创建专用用户与 /var/lib/tapesign-cache，复制当前 Node 运行时并安装 systemd 单元，不操作 SSH、其他网站或防火墙。若 Node 不在 sudo PATH，可显式传入 NODE_BINARY=/absolute/path/to/node。

更新时重新构建、上传 bundle 并重启服务；配置已打进 bundle，仅改服务器 JSON 不生效。查看日志：journalctl -u tapesign-cache。不要清空数据目录。

## HTTPS 反向代理

在自己的 HTTPS 站点中添加：

~~~nginx
location /tapesign/ {
    proxy_pass http://127.0.0.1:18741/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
    client_max_body_size 40k;
}
~~~

proxy_pass 末尾斜杠移除 /tapesign/ 前缀。缓存默认监听回环，只信任本机代理转发 IP。不需向公网开放 18741。`/notary/submit` 的签名预览请求可能超过旧合同通知的 2 KiB 限制，因此代理允许 40 KiB，服务端仍执行 40,000 字节上限及结构、签名检查。非透明原件不通过此接口上传。

将 config/app.json 的 cacheOrigin 设为 https://cache.example.com/tapesign（无末尾斜杠），重新构建、发布客户端。检查 `/tapesign/health`，再按 [合同缓存 API](CACHE-V2.md) 与 [公证 API](NOTARY.md) 携带有效参数验证查询、查重及通知；`health.notary` 提供公证记录数、待核验数量和两链扫描状态。不要用真实私人原件做部署测试。

## 运维与排错

- 停止服务后备份整个 /var/lib/tapesign-cache，再恢复服务；需同时保留合同、队列、监控与游标。
- health.contracts 是交易记录数，不是唯一合同数；queued、jobs、lastError 用于检查积压。
- 缓存预览可见但不能归档，表示独立链核验尚未成功；检查具体链、方法和节点。
- 公证显示“RPC 缓存已核验 · 链上未核验”是发布后的待核验状态；查看 `health.notary` 队列与扫描错误，不要因此重复发送。
- 公证通知出现 HTTP 413 时检查代理请求体限制；旧的 `client_max_body_size 2k` 不能承载较大的签名预览请求。
- HTTP 502 检查反向代理及服务；archive token/403/missing trie node 需归档节点。改 RPC 后重建服务和客户端，不得绕过证据核验。
- 通知、信箱监控和扫描分别调度，但仍受 RPC 能力影响，不保证固定延迟。
- V1 使用原客户端；本仓库不包含生产数据迁移工具。
