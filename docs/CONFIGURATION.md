# 配置与脱敏

## 网络配置

config/networks.json 保存支持链、公共 TapeOut 合约地址、代码哈希固定值、RPC 槽位和站点标识。开源版只含不带个人密钥的公共 RPC，不保证公共服务始终可用或保留任意历史状态。

| 字段 | 含义 |
| --- | --- |
| networks[].chainId | 支持 196（X Layer）和 56（BSC） |
| networks[].rpcs | 两个独立服务提供方的核验槽位 |
| networks[].rpcFallbacks | 主地址到同槽位备用地址列表的映射 |
| proxies / codePins | 客户端核验的公共代码指纹 |
| site | 当前协议标识 4.2.204.tape |

两槽位成功响应不一致时必须停止；备用服务只处理所在槽位的请求故障，不能掩盖分歧。不要将两个槽位改成同一个服务。

核验需要历史 eth_getCode、eth_getStorageAt、eth_call、回执和日志。能读取最新余额不代表具备归档能力。missing trie node、Archive requests require a personal token、HTTP 403/502 应通过合适节点或修复服务解决，不能跳过核验。

**配置会进入浏览器构建，不应保密的前端环境变量也一样。不要把应保密的 RPC 密钥写入公开客户端。** 使用不带个人密钥的节点，或自己的、有白名单和限流的只读网关。TapeSign 缓存不提供任意 RPC 转发。

修改配置后重新构建；配置参与版本标识，不得沿用旧清单冒充同一版本。不得改写已签文档中的 client.site、release 或签名。

## 缓存配置

config/app.json 默认配置：

~~~json
{ "cacheOrigin": "" }
~~~

空字符串不配置共享缓存。自行部署后填入 HTTPS 前缀，末尾不加斜杠：

~~~json
{ "cacheOrigin": "https://cache.example.com/tapesign" }
~~~

静态客户端直接使用该地址。本地 18740 开发客户端通过同源 /cache 转发；开发服务可用 TAPESIGN_CACHE_ORIGIN 环境变量覆盖目标，例如 http://127.0.0.1:18741。此变量不会自动写入静态构建。

合同使用缓存加速预览与发现后续签署，缓存为可选；失去缓存不会降低验证要求，仍可按交易引用与容器信箱查询链上记录。

**当前公证发布流程必须先通过缓存查重。** 未配置 `cacheOrigin`、缓存不可用或查重响应过期时，客户端保留草稿并暂停新的公证交易，不会自动跳过查重。公证公开列表和后台核验状态也优先使用此服务；用户仍可手动独立核验已存在的公证。

要完整使用签约与公证，请按 [部署指南](DEPLOYMENT.md) 启动同一缓存服务，配置可用的 HTTPS 地址并重新构建客户端。详见 [公证指南](NOTARY.md)。

## 环境变量

| 变量 | 使用位置 | 默认 / 说明 |
| --- | --- | --- |
| TAPE_RPC_PROXY | 开发服务、命令行核验 | 无；--proxy 使用本机 SOCKS 10808 |
| TAPESIGN_CACHE_ORIGIN | 开发服务 | 优先于 config/app.json |
| HOST | 缓存服务 | 127.0.0.1 |
| PORT | 缓存服务 | 18741 |
| TAPESIGN_CACHE_DIR | 缓存服务 | /var/lib/tapesign-cache；本地需设置可写目录 |
| TAPESIGN_DEV_PORT | 开发服务 | 18740；可设置其他本地测试端口 |
| TEST_BASE_URL | 浏览器测试 | http://127.0.0.1:18740；与开发服务地址对应 |
| PLAYWRIGHT_CHANNEL | 浏览器测试 | msedge；chromium 使用 Playwright Chromium |

项目不自动加载 .env，请在 shell 或 systemd 中设置变量。不要提交含凭据的环境文件。

## Fork 与站点身份

当前协议的 client.site 固定为 4.2.204.tape。自托管静态客户端可以保留此标识；向该链上站点发布需要持有人钱包。

Fork 为不同链上产品时，应同时审阅 config/networks.json、src/protocol.js、src/compatibility.js、scripts/build.mjs、src/publish.js 和测试中的站点/网关约束。仅修改 config.site 不足以形成新协议实例；身份替换后不能宣称旧签名仍有效。

## 提交前检查

运行 npm run check:public 并人工审阅 git diff --cached。检查覆盖常见凭据、私人绝对路径、真实数据目录与生成文件，但不保证发现所有秘密。

不要上传 .local/、dist/、release/、server/cache.bundle.mjs、缓存存储、部署凭据或真实合同报告。交易哈希虽公开，也可能关联现实当事人和正文；示例只使用合成数据。
