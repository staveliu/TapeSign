# TAPESIGN-2 协议

应用版本 0.1.0、合同协议 TAPESIGN-2 和清单格式 TAPESIGN-RELEASE-1 是不同概念。本说明对应 src/protocol.js、src/reader.js 及相关模块。

## 编码与正文

TapeSend v2 public header 为 0x54530200，后接规范 JSON UTF-8。对象键字典序排列，重新编码必须与原字节相同；拒绝重复键、额外字段、不规范空白/数字。总载荷上限 16,000 字节。

正文为块数组，每块有 type（p/h2/li）和 runs；run 只含 text 与 marks（三位样式）。通过 createElement/textContent 渲染，不执行任意 HTML、SVG、图片或脚本。拒绝不可见控制/双向覆盖字符。正文结构上限 6,500 UTF-8 字节。

## 合同号与指纹

可读 doc.contractId 格式为 TS-<17 位 UTC 毫秒时间>-<32 位十六进制随机标识>，由 createdAt 与 nonce 前 128 位派生，无需中心发号器。随机性降低同毫秒碰撞概率，不是排他登记保证。

documentId(doc) 是规范完整文档的 Keccak-256（bytes32）。它覆盖合同号、协议、正文、双方、角色、nonce、创建时间及客户端版本。EIP-712 Consent.contractId 和 Hub ref 使用此指纹，不能与可读编号混用。

createdAt 是客户端声明的时间，不是可信时间证明；链区块时间另行核验。列表按可读编号归并，同号异指纹显示冲突，不能混合签名。

## 身份和笔迹

身份包含规范容器名、chainId、processor、tokenId、container、holder、endpoint。界面省略 .tape，协议保留。endpoint = uint32(0) || uint64(chainId) || address(container)，支持 196/56。

签署主体固定为发起时持有人；转让容器不会改写 doc。当前仅支持 EOA EIP-712，不实现 ERC-1271。

笔迹是整数点数组，坐标范围 1000×400，最多 30 笔、220 点、不超过 2,300 字节，并校验最小长度。简化后重新绘制最终保存的轨迹。笔迹本身不是唯一身份凭证。

## EIP-712 同意签名

Domain：name=TapeSign，version=2，chainId 为签署人的容器链，verifyingContract 为该链 Hub。

~~~text
Consent(bytes32 contractId,string role,bytes32 container,
        bytes32 handwritingHash,bytes32 offerTransaction)
~~~

contractId 为 documentId(doc)，role 为 A/B，container 为 endpoint，handwritingHash 为规范笔迹 Keccak-256。发起方 offerTransaction=0；对方绑定实际 offer 交易哈希。钱包签名因此绑定正文、双方、角色、容器、笔迹和签署阶段。

## 消息

| 类型 | 字段（省略 protocol/type） | Hub ref / to |
| --- | --- | --- |
| offer | contractId、完整 doc、发起方 consent | 0 / 对方 endpoint |
| accept | contractId、documentHash、offer {chainId,tx}、对方 consent | 指纹 / 发起方 endpoint |
| seal | contractId、完整 doc、offer/accept 定位、按 A/B 排序的原始 consents | 指纹 / 对方 endpoint |

顶层 contractId 为可读编号，accept.documentHash 为指纹。seal 由原发起人发送，包含双方原始同意数据。跨链收件消息仍在发送链；容器收件查询覆盖两链，合同读取按明确 chainId 定位。

## 核验与确认

检查交易 input、receipt、Sent、历史 inbox/outbox digest、代码哈希、容器绑定、NFT 持有人及签名。验证读取要求两独立 RPC 一致；备用只处理所属槽位故障，不掩盖成功响应分歧。

固定共同可见 finalized/latest 快照，结束时复查固定区块及交易区块哈希。空回执和读取失败保持等待/未核验，不授权重发。

浏览器短确认：X Layer 后续 12 块，BSC 后续 24 块，以两节点较低高度计算；最新头不落后超过 60 秒、不超前超过 15 秒；全部依赖均满足。已 finalized 的交易直接满足确认条件。

短确认可开放回签/归档，最终性另显。页面约每 10 秒复查，提交前及钱包同意签名后/广播前重查引用；证据变化停止操作。区块深度不能保证最终性或撤回已广播交易。命令行默认要求最终确认。

## 后续发现与缓存

通过明确引用、容器信箱及增量日志发现后续阶段。候选须匹配编号、指纹、原 offer 和已选择 acceptance 分支。seal > accept > offer 仅是显示优先级，不代表同号最新交易即唯一有效分支。

缓存可提供签名可验证的正文预览；签署、归档与导出必须通过客户端独立链核验。后台单节点日志只发现候选哈希，完整核验仍为双节点。见 [缓存设计](CACHE-V2.md)。

协议没有链上专用合约禁止重复 offer/accept/seal。客户端本地持久化减少重发，其他设备或手工提交仍可能重复；精确引用不能省略。

## 版本和存续

src/、config/、scripts/、index.html、package.json、package-lock.json 字节参与 source release ID；清单记录构建文件大小、SHA-256 和版本入口。缓存服务代码不是该 ID 的完整组成部分，服务端也不充当客户端核验权威。

合同绑定 client.site=4.2.204.tape 与版本；兼容表仅允许已审核 V2 继续签署。V1 使用原客户端，不迁移、不改写历史签名。

TapeOut 能校验所读取链上字节的传输完整性，但站点持有人仍可能更新文件。哈希路径不是只读权限；保存独立可信清单、源码、客户端和证据，不能依赖被替换代码自称通过。

代码固定值变化会停止验证，不假定所有代理已封印。订阅到期、历史状态不可用或外部 RPC 网络策略都可能影响读取。本项目不是共识轻客户端，也不提供完整链状态的离线证明。
