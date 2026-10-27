# 矩阵流项目记忆

最后整理：2026-10-27（Asia/Hong_Kong）。

当前交接版本：**0.11 / npm `0.11.0-alpha.1` / Git 标签 `v0.11.0-alpha.1`**。

本文件供另一台电脑、没有本次会话记忆的开发者或 AI 接续开发。代码与实际文件状态高于本文件的历史描述；恢复工作时先核对分支、提交和 `TODO.md`。不要在这里保存登录凭据、密钥、Cookie 或真实数据明细。

## 1. 项目身份与当前方向

- 名称：矩阵流；GitHub：<https://github.com/fallenkobe/juzhenliu>，私有仓库。
- 主分支：`main`；远程名：`origin`；HTTPS 地址：`https://github.com/fallenkobe/juzhenliu.git`。
- 最早已推送的应用基线：`7f0ccbb`，Alpha 0.01，提交说明 `feat: add Alpha 0.01 local operations workbench`。
- 本次交接把基线之后的 OAuth、浏览器助手、真实数据同步、分周期分析及文档提交为 0.11 Alpha 版本。确切提交用标签查询，不在本文件维护会导致循环修改的本次提交 SHA。
- 首台电脑的工程目录是 `D:\矩阵流`。这是历史环境信息，不是程序要求的固定路径；第二台电脑可放在其他目录。

用户最终希望有一个 Web 管理后台：绑定多个自有抖音账号、分析账号及作品数据、原创视频一键多账号发布、DOU+ 投流，后续挂商品或团购。未来可按 VIP 等级配置账号数量，具体档位和数量尚未商业验证。

当前没有公司主体和营业执照，抖音官方能力接入条件不足。近期开发重点已从官方 OAuth 验证转为 **矩阵流 + 本机浏览器助手**，先完成自有账号登录和经营数据汇总。不要擅自把下一步扩展为真实发布或扣费。

## 2. 已确认需求与协作方式

1. 内容来自用户原创，自有账号优先，长期目标是提升多账号运营和素材测试效率。
2. DOU+ 是用户指定的投流渠道，不能用其他广告 API 的能力代替 DOU+。
3. 前端沿用抖音网页版的深色、玫红、青色配色，但使用矩阵流自有品牌。
4. 用户明确希望实际写代码、修复问题并完成授权范围内的工作；不要重复询问已经授权的可逆操作。
5. 最近用户曾要求“先实现功能，不用验证”。因此新增周期不是全部真实验收过；之后近 7 天故障排查做了针对性验证，不能扩写为所有周期验证通过。
6. 用户现在需要两台电脑开发，核心要求是代码、文档和记忆可由 GitHub 接续；本机登录态和真实数据不通过 GitHub 同步。

## 3. 当前能力地图

| 模块 | 当前实现 | 实际边界 |
| --- | --- | --- |
| `/` 演示工作台 | 账号、数据总览、分析、素材、发布、投流、任务、设置 | 账号、原统计、发布、DOU+ 结果为演示；实际视频上传可用 |
| `/assistant` 本机助手 | 独立 Edge 扫码、页面读取、官方 Excel 自动导出、导入对照 | 单机、单浏览器配置、自有账号验证；不是公网多租户服务 |
| 作品分析 | 昨天、近 7 天、近 30 天；合计、每日趋势、明细 | 近 7 天与近 30 天有真实验证；昨天尚未真实验收 |
| 粉丝分析 | 昨天、近 7 天、近 30 天；期末粉丝、净增、吸粉、脱粉、回访 | 近 7 天有真实验证；昨天与近 30 天尚未真实验收 |
| 全周期同步 | 顺序同步作品/粉丝各 3 个周期，保留部分成功与失败原因 | 代码已实现，未完成全部 6 周期真实连续验收 |
| `/douyin` 官方 OAuth | 官方跳转、一次性 state、换码、公开资料、加密凭证、管理会话 | 只有代码与受控响应测试，没有真实应用凭证/HTTPS 回调联调 |
| ALQQ | 已研究公开 API，未实现适配器 | 不能在矩阵流仅绑定一次后直接使用其发布；见下文 |
| 真实发布 / DOU+ / 商品 / 团购 | 未接入 | 不得展示为已可用能力 |

## 4. 技术栈和运行环境

- TypeScript，Next.js `16.4.3`，React / React DOM `19.3.1`。
- Node.js 至少 `22.13.0`（使用 `node:sqlite`），本次环境实际为 **22.21.0**，npm **10.9.4**。
- `.node-version` / `.nvmrc` 固定已使用的 Node 版本；Windows 不同版本管理器的使用方法见开发说明。
- SQLite 默认零配置，WAL 模式，`BEGIN IMMEDIATE`；通过进程内串行队列保护 SQLite 事务。
- `pg` 提供 PostgreSQL 分支，尚未连接真实 PostgreSQL 实例验收。
- 独立 Node worker 执行原演示任务；`tsx` 用于 worker、助手和 TypeScript 测试。
- 本机助手使用 `playwright-core@1.64.1` 调用**已安装的 Microsoft Edge**，不会自动安装浏览器。
- Excel 读取使用 `exceljs@4.4.0`。`overrides` 将其间接 `uuid` 固定为 `11.1.1`，此前依赖审计报告过旧 uuid 问题；不要随意删除覆盖项。
- `zod` 用于接口数据校验；`lucide-react` 图标。
- 当前助手与浏览器测试以 Windows + Edge 为实际验证环境；其他系统尚未适配或承诺。

依赖版本以 `package.json` 和 `package-lock.json` 为准，跨电脑使用 `npm ci`，不要复制 `node_modules`。

## 5. 从零启动：第二台电脑

详细步骤见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。最短路径：

```powershell
git clone https://github.com/fallenkobe/juzhenliu.git
cd juzhenliu
git fetch origin --tags
npm ci
npm run dev
```

第二个终端，在同一仓库根目录运行：

```powershell
npm run assistant
```

- 浏览器：`http://127.0.0.1:3000/assistant`。
- 点击「打开登录窗口」，在**助手打开的 Edge** 中自行扫码，然后打开数据表现页。
- 填写/核对账号备注、勾选自有账号确认，选择周期，点击相应同步按钮。
- 默认不用配置任何官方 OAuth 密钥即可尝试助手路径。
- GitHub 网页登录、Codex 的 GitHub 连接与命令行 Git 的身份验证是不同机制。新电脑需要独立配置命令行 Git 身份与 GitHub 凭据。
- 不要从旧机器复制 `.data/browser-assistant/profile` 或 `connection.json`。新电脑独立登录和配对。
- 仅启动 Web 不代表助手已启动。Web 与 worker、浏览器助手是两个启动命令。

## 6. 目录与重要文件

```text
AGENTS.md                           AI/开发者交接入口与约定
PROJECT_MEMORY.md                   本项目记忆
README.md / TODO.md / CHANGELOG.md  产品范围、任务与版本变化
docs/DEVELOPMENT.md                 双机安装、同步与故障处理
docs/VERSIONING.md                  分支、提交、标签与版本规则
apps/web/app/                      页面及 Next API
  api/[...segments]/route.ts       原演示业务接口
  api/douyin/[...action]/route.ts   官方 OAuth 接口
  api/assistant/[...action]/route.ts 本机助手受限桥接
  assistant/page.tsx               助手页面
  douyin/page.tsx                  官方 OAuth 备选页面
apps/web/components/
  workbench.tsx                   原演示工作台
  local-assistant.tsx             助手连接、账号备注、同步编排
  period-analysis.tsx             分周期汇总、趋势、明细
  douyin-login.tsx                官方 OAuth 登录与配置检查
apps/assistant/
  index.ts                        本机 HTTP 服务、配对密钥、动作白名单
  browser.ts                      专用 Edge、区域定位、选择日期、下载、缓存
apps/worker/                      原演示任务引擎
packages/assistant/
  paths.ts                        本机运行目录推导
  metrics.ts                      作品 XLSX、单位、缺失值、参考表对照
  analysis.ts                     粉丝 XLSX、周期检查、正确汇总
packages/db/index.ts               SQLite/PG、迁移与事务
packages/db/oauth-schema.ts        官方 OAuth 独立迁移结构
packages/domain/                  原业务与 OAuth 服务
packages/providers/               demo 与官方 douyin HTTP 适配
scripts/dev.mjs                   同时启动 Web 与 worker
tests/business.test.ts            18 个原业务集成测试
tests/douyin-auth.test.ts          14 个 OAuth 受控响应测试
tests/assistant.test.ts            4 个助手解析/浏览器夹具测试
tests/e2e/                       页面/API/移动端测试
validation/                      早期 40 个离线架构模型场景
```

## 7. 本机助手：实际工作原理

1. `apps/assistant/index.ts` 默认监听 `127.0.0.1:37211`，每次启动生成随机配对密钥。
2. 将 `port/token/pid/startedAt` 写入 `.data/browser-assistant/connection.json`；此文件不提交。
3. Next 的 `/api/assistant/*` 从本机文件取得密钥，代理固定动作到回环端口，前端拿不到密钥。
4. 助手校验 Host、Bearer，拒绝带 Origin 的直接请求；Web 桥接只接受 localhost/127.0.0.1 同源请求。
5. Edge `launchPersistentContext` 使用 `.data/browser-assistant/profile`，与用户默认浏览器及 Codex 内浏览器相互独立。
6. 用户自行扫码和完成安全验证；助手不读取默认浏览器 Cookie，也不把登录态发给第三方数据服务。
7. 数据页路径是 `https://creator.douyin.com/creator-micro/data-center/operation`。
8. 作品与粉丝存在两个同名「导出数据」按钮，必须按所属区域与指标标记准确区分。
9. 页面指标只从可见 DOM 读取；每日数据来自官方导出按钮触发的 XLSX，不从图表推测，也不依赖未验证的内部接口。
10. 固定允许的页面导航与动作白名单，不开放任意 URL、脚本或本地文件路径执行接口。

`status()` 返回浏览器状态、最近原始快照、参考表对照、分周期分析及派生汇总。`creator_visible` 仅说明创作者页面可见，不等于已自动核实账号身份。

## 8. 助手接口与数据存储

| Web 接口 | 用途 |
| --- | --- |
| `GET /api/assistant/status` | 状态与缓存，助手离线时返回可理解的提示 |
| `POST /api/assistant/open` | 仅允许 `home` 或 `data` 页面 |
| `POST /api/assistant/close` | 关闭专用浏览器，助手服务仍在 |
| `POST /api/assistant/inspect` | 读取当前可见指标/表格 |
| `POST /api/assistant/last30` | 保留的作品近 30 天选择动作 |
| `POST /api/assistant/sync` | 保留的当前作品官方导出与参考表核验 |
| `POST /api/assistant/reference` | 上传参考 XLSX 原始字节 |
| `POST /api/assistant/analyze` | 按类型、周期获取分析数据 |

`analyze` JSON：`accountLabel` 为 1–40 字备注，`topic` 为 `works` 或 `fans`，`range` 为 `yesterday` / `7d` / `30d`。写请求头为 `X-Matrix-Request: assistant-0.11`，并须满足同源条件。桥接的分析请求超时为 90 秒。

本机文件：

- `profile/`：浏览器配置与登录态。
- `exports/*.xlsx`：助手自动接收的官方导出原文件。
- `reference.json`：参考表的规范化数据。
- `latest.json`：旧同步/页面读取的最近快照，用于参考表核验。
- `analyses.json`：按账号备注、类型、周期独立保存的记录，当前最多保留 120 个组合的最近结果。
- `page-preview.png`：页面读取时的本机诊断图片。
- `verification.json`：此前真实 30 天对照的本机证据摘要。

`analyze` 不覆盖 `latest.json`；因此新周期面板与原“采集结果/参考表对照”可能展示不同时间的独立数据。这是当前设计，不能误以为两个区域必须同步变化。

账号备注会在浏览器会话中记住，并能从已有记录恢复。刷新后自有账号确认需要重新勾选；页面已补充原因提示。点击时间标签只切换已保存数据，获取最新数据需点击“同步作品/粉丝数据”。

## 9. 指标与汇总规则

作品导出表头：日期、投稿量、总播放量、总点赞量、总分享量、总评论量、5秒完播率、2秒跳出率、封面点击率、平均播放时长。

粉丝导出表头：日期、总粉丝量、粉丝净增、吸粉量、脱粉量、回访粉丝量。近 7 天真实报表已确认使用这些字段。

- 百分比转换为比例，播放时长转换为秒；千分位、万/亿单位按解析规则处理。
- `-`、空白、暂无数据保留为 `null`，不能填 0。真实 0 与缺失不同。
- 点赞、评论等可能为负，真实导出已见到，保留原值，不擅自修正；具体解释依据平台统计口径。
- 投稿、播放、点赞、分享、评论按期间合计；任一天缺少待合计指标时该合计不可用，不默默少算。
- 日完播率、跳出率、点击率和平均播放时长没有足够分母时，不能简单平均为期间指标。
- 期末粉丝数取导出最后一天，不把每天总粉丝数相加。
- 净增、吸粉、脱粉求期间合计；回访粉丝仅展示最后一天，不做未经去重的跨日人数合计。
- 日期按导出文件为准，UI 显示实际起止日。不要用本机今天强行改写报表日期。
- `validatePeriod` 要求 1 / 7 / 30 条连续每日记录；不匹配时保留已有分析并报错。
- 参考表对照逐日比较 9 项指标，明确区分完整匹配、部分日期、无交集、有差异、待数据。

## 10. 官方 OAuth 备选：保留但尚未实际接通

代码使用官方 `platform/oauth/connect/` 授权、`oauth/access_token/` 换码、`oauth/userinfo/` 获取昵称和头像，只请求 `user_info`。

- 必需环境变量：`MATRIX_OWNER_PASSWORD`（至少 24 位）、`DOUYIN_CLIENT_KEY`、`DOUYIN_CLIENT_SECRET`、`DOUYIN_REDIRECT_URI`、`DOUYIN_TOKEN_KEY`（64 位十六进制）。
- HTTPS 回调路径必须为 `/api/douyin/callback`，与开放平台登记一致；不支持以 localhost 作为该官方回调。
- 在回调同一站点发起授权，以保留绑定 state 的管理 Cookie。
- 管理 Cookie 与演示 Cookie 分开；12 小时、HttpOnly、SameSite=Lax，HTTPS 登录设 Secure。
- state 十分钟、一次性、绑定管理会话；拒绝、过期、重放不重复换码。
- 令牌通过 AES-256-GCM 加密；账号列表不返回令牌或 open_id。
- 真实 OAuth 资料存 `douyin_connections`，不写入演示 `accounts`。
- 令牌自动续期未开发，到期需重新授权；删除本地记录不等于撤销抖音端授权。
- 没有真实应用凭证与 HTTPS 域名，不能声称已完成官方真实授权验收。

新电脑默认走本机助手，不需要为了启动项目先解决官方应用申请。

## 11. 原 Alpha 0.01 工作台与数据层

- 单个共享演示工作空间、演示登录，服务端哈希会话；不是生产注册和成员权限系统。
- SQLite 默认 `.data/alpha.sqlite`，schema_migrations 包含 `001_alpha`、`002_douyin_oauth`。
- 原业务包含工作空间、账号、素材、作品、预检、发布批次/任务、投流批次/订单、指标、审计、worker 心跳。
- 原业务租户复合外键与事务用于约束演示操作；不能据此声称本机助手已具备同等级的多租户隔离。
- 本地视频单文件 50 MB，工作空间 500 MB，MP4/WebM 头检查；没有完整媒体检测、杀毒或对象存储。
- 发布/投流路径有 5 分钟预检确认单、幂等键、授权版本、预算占用与未知结果处理。
- 未知结果不会自动重发；停止投流意图在 worker 确认前保留预算。
- 外部发布与广告支付始终为 demo 适配器。`ALPHA_MODE` 仍保持 `demo`，不是通过改成 production 启用真实能力。

## 12. 验证记录：必须区分范围

### 本次未发布的配置统一改动（2026-10-27）

- 已检查 `scripts/dev.mjs` 与 `packages/config/env.ts` 语法、`git diff --check`；用临时根目录验证 `.env` 中的助手端口、相对数据目录、助手目录和显式进程环境变量优先级。
- 本机执行 `npm ci --offline --no-audit`、`npm run typecheck`、`npm test`（36/36）和 `npm run build` 均通过。普通沙箱中的无头 Edge 测试与 Turbopack junction 创建受限，测试及构建在正常本机权限重跑通过。此次运行的 Node 为 24.15.0，仍待按项目指定的 22.21.0 版本复核。
- 没有启动完整 Web/worker/助手服务、进行配对或操作真实抖音账号；下方 0.11 真实账号记录来自交接版本，不能当作本次验证。

### 本次版本提交前（2026-10-27）

- `npm run typecheck`：通过。
- `npm test`：36 / 36 通过（18 原业务、14 OAuth 受控响应、4 助手解析/浏览器夹具）。这些不是新增所有分析周期的完整测试覆盖。
- `npm run build`：通过，包含 `/`、`/assistant`、`/douyin` 与三个 API 路由组。
- 本次交接没有再次运行全部真实账号周期，也没有重跑全量 E2E。

### 此前真实/浏览器记录

- 单自有账号扫码与专用浏览器保留登录成功，DOM 可读 9 项作品指标。
- 作品近 30 天自动导出：2026-09-26 至 2026-10-25，与用户参考表 30 × 9 = 270 项一致，0 差异。
- 近 7 天排查：作品和粉丝均从助手接口与矩阵流页面同步成功，报表为 2026-10-20 至 2026-10-26。
- 近 7 天页面汇总各 5 张卡片可展示，未发现浏览器运行错误。
- 刷新后备注恢复、确认提示和两个近 7 天面板已做针对性页面检查。
- 更早的 14 项 E2E（助手离线入口、隔离、移动端、OAuth、原业务）通过；该记录早于新周期和备注提示的全部改动，不能当作当前所有新增功能的全量 E2E 证据。
- 早期 `validation/` 的 40 场景是离线架构模型，不是真实平台验证。

### 明确尚未验收

作品昨天、粉丝昨天、粉丝近 30 天的真实完整链路；全部 6 周期连续同步；多账号和唯一身份核实；长期登录过期恢复；第二台电脑首次启动；PostgreSQL；真实发布/DOU+；公网部署。

## 13. 已知问题与排查顺序

### 前端打不开

先检查 Web 是否启动和 3000 端口。GitHub 推送不会启动本地服务。`npm run dev` 同时启动 Web + worker；助手另行启动。不要把历史 PID 写死到脚本。

### 助手离线或登录不同步

先运行 `npm run assistant`，确认 Web 与助手用的是同一目录和 `.data`。Codex 内浏览器或默认 Edge 的登录态不会自动出现在专用配置。助手无 CORS 公网访问入口是预期行为。

### 近 7 天不能同步 / 按钮禁用

最近排查中两类接口均正常，未复现统一接口故障。发现刷新清空备注、确认状态造成按钮禁用且说明不足，已修复备注恢复和状态说明。先看连接、备注、确认勾选、所选周期，再看实际错误文字。不能把“按钮禁用”直接判为抖音导出接口坏了。

### 实际文件天数错误或字段不符

查看当前平台是否切到了正确区域和周期；作品、粉丝不能共用错误的导出按钮。不得为了让界面成功而放宽成静默接受错误天数。报表日期和更新时点以源数据为准。

### 根环境配置

`scripts/dev.mjs` 在读取 `PORT` 前加载仓库根目录 `.env`，再将环境传给 Web 与 worker；独立助手和数据库入口通过 `packages/config/env.ts` 加载同一文件。显式设置的进程环境变量优先，缺少 `.env` 时使用默认值。相对 `MATRIX_DATA_DIR` 以仓库根目录为基准，因此三个进程使用同一个本机数据目录。配置读取的代码已更新；本次完整启动检查范围见本节下方记录。

### 环境与开发历史

首台环境普通沙箱 shell 曾出现 `setup refresh had errors`，当时通过工具的正规提权审批运行仓库命令；这是环境问题，不应写成项目运行要求，更不能绕过另一台机器的审批。也曾遇到账户用量导致自动审批无法完成，动作未执行；恢复后须重新检查文件，不能假定已写入。

Next 的内部 URL 可能是 localhost，原接口的来源校验需使用实际 Host；不要回退到仅比较内部 URL。Playwright 单独脚本请求需使用完整 URL 或正确 baseURL。tsx 序列化到浏览器的 evaluate 回调内，避免声明会注入 `__name` 的局部命名函数。

## 14. 第三方调研结论（非已接入能力）

ALQQ 公开文档研究日期为 2026-10-27，文档当时标注更新于 2026-10-24；继续使用前应重新核对。

- 个人 API 密钥调用其开放 API；可查询本人已在 ALQQ 中添加的账号、执行节点、发布状态，支持批量视频发布。
- 不提供公开账号登录、绑定、重登、刷新 Cookie、解绑或删除接口。矩阵流自己获得的官方 OAuth 令牌不能直接作为其发布账号。
- 视频发布需在线 Windows 客户端或满足授权与能力条件的 edge 节点，文件先放到实际执行机器；不支持直接传远程视频 URL，也不是共享 Web 上传转发。
- 未找到公开点赞/粉丝经营分析、DOU+ 或商品/团购挂载接口；`products` 是 ALQQ 产品库，不等于抖音商品挂载。
- 当前没有 ALQQ 适配代码，也没有真实密钥联调；个人开通和二次商业化权限仍待确认。

TikHub / TikOmni 的创作者数据文档曾研究到依赖账号 Cookie 的接口，但未接入、未联调、未获用户授权发送真实 Cookie。当前实现不依赖这些服务，不得自动上传登录态来替换本机方案。

## 15. 下一步优先级

1. 保证另一台电脑按开发说明从干净 clone 启动；新电脑独立扫码，确认助手目录和配对正常。
2. 根据用户下一条指令决定是否验证剩余周期；用户只要求实现时不批量触发真实操作。
3. 补充 `analysis.ts` 的周期、粉丝存量/增量、缺失值和缓存隔离测试，完善“选择日期到下载”时序保障。
4. 用独立本机数据目录检查 Web、worker、助手的根环境配置读取与配对；代码层已统一。
5. 真实账号唯一标识与备注分离，再设计多账号独立浏览器配置、明确的账号确认与归属。
6. 需要商业化时，再评估稳定数据接入、隐私边界、正式身份系统与真实发布供应商；DOU+ 单独立项验证。

不要默认接着开发发布、投流或多账号。以用户最新目标为准。

## 16. 给新会话的接续提示

可以把下面文字发给另一台电脑的开发助手：

> 请先阅读根目录 AGENTS.md、PROJECT_MEMORY.md、TODO.md、docs/DEVELOPMENT.md 和 docs/VERSIONING.md，再检查当前分支与 Git 状态。项目是矩阵流，0.11 Alpha。真实可用路径为 /assistant 的本机 Edge 助手；原工作台发布和 DOU+ 仍是演示，官方 OAuth 尚未真实接通。不要依赖上一个聊天的记忆，也不要复制浏览器 Cookie。先根据这些文件恢复上下文，再执行我接下来的具体需求。

更新本文件时保留决策缘由、当前行为、确证结果和未完成项，清理已经过时或相互矛盾的状态。历史细节归相应版本说明；不要把它变成真实数据或敏感日志的存储位置。
