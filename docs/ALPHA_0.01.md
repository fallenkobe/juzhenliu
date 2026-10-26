# Alpha 0.01 开发与验收说明

版本日期：2026-10-27。界面版本为 **Alpha 0.01**，npm 版本为 `0.0.1-alpha.1`。这是可运行的本地演示应用，真实第三方账号、发布及广告支付均未接入。

## 1. 已落地的基础流程

| 流程 | 当前实现 |
| --- | --- |
| 进入工作台 | 明确点击进入演示，服务端创建 12 小时会话；HttpOnly / SameSite Cookie；退出销毁会话 |
| 账号管理 | 展示、搜索、添加演示账号、演示同步、恢复失效的演示授权；服务端配额与授权代次 |
| 数据分析 | 固定种子快照、7/14 天趋势、账号筛选、作品表现和带演示来源说明的 CSV 导出 |
| 素材管理 | 演示封面、真实 MP4/WebM 文件上传与预览；单文件 50 MB，工作空间 500 MB |
| 批量发布 | 选择素材和账号、填写文案、预检、确认、数据库任务、独立 worker、逐账号结果 |
| DOU+ 流程 | 选择演示公开作品、设置模拟目标和预算、预检、确认单、预算占用、模拟付款/审核/投放/结算 |
| 异常演练 | 正常、明确拒绝、未知结果；未知结果仅核验原任务，不再次提交 |
| 停止投流 | 停止请求与最终结算分离，未确认前不立即释放预算 |
| 设置与追踪 | 每日确认额度、跨日在途上限、策略版本、任务引擎心跳和持久化审计日志 |
| 前端体验 | 炭黑 / 深灰 / 玫红配色、少量青色强调、自有品牌、桌面与移动端布局、键盘弹窗操作 |

演示账号中的粉丝、初始作品和历史指标是种子数据。用户新建的演示账号初始指标为 0；演示发布的新作品不会自动获得虚构播放量。投流结算由演示适配器生成固定比例数据，始终标记为模拟，不能用于分析真实投放收益。

## 2. 本地启动

需要 Node.js **22.13 或以上**和 npm。当前机器以 Node.js 22.21.0 验证；该 Node 版本的 SQLite 模块会输出实验性功能提示。

```powershell
cd D:\矩阵流
npm ci
npm run dev
```

打开 [本地工作台](http://127.0.0.1:3000)，点击“进入 Alpha 演示”。`npm run dev` 同时启动 Web 和独立任务进程，首次请求或 worker 启动时自动初始化演示数据。Ctrl+C 关闭。

配置文件可从 `.env.example` 复制为 `.env`，不填写也能使用 SQLite 演示。默认监听 `127.0.0.1`，本版不作为公网服务发布。

自定义端口：

```powershell
$env:PORT = '3001'
npm run dev
```

生产构建的本地预览：

```powershell
npm run build
npm run preview
```

也可以分别运行 `npm run start` 与 `npm run worker`。只启动 Web 时，界面会提示任务引擎离线，任务保存在数据库等待 worker，不会由页面请求代为执行。

## 3. 持久化与数据边界

默认 SQLite 位于 `.data/alpha.sqlite`，上传文件位于 `.data/uploads/<workspace_id>/`。数据库启用 WAL、外键和忙等待，事务通过本进程串行执行及 SQLite 写事务锁保护；不能把这些测试等同于高并发生产数据库验证。

设置 `DATABASE_URL` 后使用 PostgreSQL 连接池，事务使用同一 client，并对工作空间加行锁；初始迁移使用 PostgreSQL 事务级 advisory lock。本机没有 PostgreSQL 服务，因此该模式已实现、通过类型和构建检查，但**尚未真实运行验收**。正式使用前须补充 PostgreSQL 集成测试。

初始 schema 在 `packages/db/index.ts`，登记迁移版本 `001_alpha`。后续结构变更应新增显式迁移，不应通过修改初始 schema 期待现有数据库自动升级。文件当前保存在本机，私有对象存储、病毒扫描与完整视频解码检查仍未实现；上传检查仅覆盖大小、格式头及存储配额。

演示只有一个共享工作空间，登录按钮不校验真实用户身份。会话、服务权限和工作空间归属检查已实现；多用户注册、成员邀请、完整身份认证和生产授权仍待开发。本版接口和监听方式仅用于本机体验。

`.data/`、`.env`、依赖、构建缓存和测试产物均已被 Git 忽略。不要将本地数据目录当作可随构建迁移的数据库或素材备份。

## 4. 代码结构

```text
apps/web/app/                页面、深色样式和 HTTP 路由
apps/web/components/        工作台、发布/投流确认及其他交互
apps/worker/                独立轮询引擎与演示状态流转
packages/domain/            业务类型、预检、幂等、配额和预算服务
packages/db/                SQLite / PostgreSQL 访问、初始迁移和种子数据
packages/providers/demo.ts  不含外部 HTTP 调用的演示适配器
scripts/                    启动与数据库初始化
tests/                      真实 SQLite 业务测试、浏览器端到端测试
validation/                 上一阶段的离线架构参考模型
```

## 5. 已实现的 HTTP API

所有业务读取要求演示会话。所有写请求要求同源检查及 `X-Matrix-Request: alpha-0.01`，第三方 Origin 的请求会拒绝；这不等于开放跨站调用能力。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /api/health | 版本与演示模式 |
| POST / GET / DELETE | /api/session | 创建、检查及销毁演示会话 |
| GET | /api/bootstrap | 工作空间、账号、素材、指标、任务、订单、预算和心跳 |
| POST | /api/accounts | 添加演示账号 |
| PATCH | /api/accounts/:id | 演示同步、失效或重新授权 |
| POST | /api/assets | multipart 上传，内容头与大小检查 |
| GET | /api/assets/:id/content | 校验工作空间后访问视频文件 |
| POST | /api/publish/previews | 发布预检，生成 5 分钟确认单 |
| POST | /api/publish/batches | 通过确认单与请求键提交批次 |
| POST | /api/promotion/previews | 作品与预算预检 |
| POST | /api/promotion/batches | 原子预留预算并创建演示投流 |
| POST | /api/promotion/orders/:id/stop | 提交演示停止请求 |
| POST | /api/tasks/:kind/:id/reconcile | 核验演示未知结果，kind 为 publish / promotion |
| PATCH | /api/settings/budget | owner 更新策略，校验版本 |
| GET | /api/analytics/export | 当前空间的完整演示指标 CSV，覆盖种子快照，不仅是页面所选日期 |

这些路由是架构草案的首版实现，实际 URL 以本表为准。真实 webhook、供应商 OAuth 和真实付款端点尚未提供。

## 6. 验证命令与范围

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
python -m unittest discover -s validation -p 'test_*.py' -v
```

业务测试使用隔离临时 SQLite，验证会话、角色、跨工作空间引用、账号额度、发布幂等、未知结果、授权失效、预算并发、停止结算、策略版本及外键约束。浏览器测试使用独立 Web/worker 与数据目录，覆盖登录、搜索、添加账号、刷新后恢复、发布、投流、停止、未知结果核验、实际录制 WebM 上传和移动端宽度。

浏览器测试默认在 Windows 检测到 Edge 时使用无痕 headless Edge。其他机器可安装测试浏览器：

```powershell
npx playwright install chromium
npm run test:e2e
```

测试截图输出在 `.data/previews/`，测试服务会在结束后关闭。本轮最终检查结果见文档末尾验收记录。

## 7. 当前限制与下一步

- 无真实抖音授权、真实指标、外部发布或广告扣费。
- 无真实用户注册、完整多租户成员管理、会员支付或订阅。
- PostgreSQL、私有对象存储、供应商回调验签及真实跨系统恢复仍待验收。
- 素材不支持删除、转码或视频时长解析；定时发布、失败任务重试、预算追加和自动续投尚未开放。
- 页面的任务/作品列表首期有数量上限，尚无完整服务端分页；演示数据同步只更新时间，不生成随机增长。
- 真实接入前仍须满足 [G1–G8 门槛](PROVIDER_CAPABILITIES.md)，不以本地测试代替供应商许可及真实联调。

## 8. 验收记录

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| TypeScript | 通过 | Web、业务层、worker 和测试源码 |
| SQLite 业务集成 | 18 / 18 通过 | 真实本地事务与外键、并发服务调用、状态流转；未覆盖 PostgreSQL 或跨机器压力 |
| 浏览器端到端 | 8 / 8 通过 | 开发服务与生产构建各执行完整一轮，覆盖桌面、移动端、上传、发布及模拟投流 |
| 最终界面回归 | 3 / 3 通过 | 生产构建下的总览、账号持久化/缺失指标与移动端截图 |
| 生产构建 | 通过 | 静态页面和动态 API 均打包成功 |
| 视觉检查 | 已完成 | 1440px 桌面、390px 移动端；修正抽屉关闭动画截图和开发指示器 |
| 真实供应商与 PostgreSQL | 未执行 | 没有实际账号、接口凭据或 PostgreSQL 服务；未发生真实投放费用 |

此前架构报告中“仅有模型”的描述属于上一阶段；本表仅确认本地 Alpha 演示业务，不意味着已完成真实抖音集成。测试服务已在结束后关闭，手动体验请运行 `npm run dev`。
