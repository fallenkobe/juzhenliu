# 双机开发与新电脑接续

当前交接版本为 `v0.11.0-alpha.1`。功能、架构和已知限制先看根目录 [PROJECT_MEMORY.md](../PROJECT_MEMORY.md)，任务看 [TODO.md](../TODO.md)，版本规则看 [VERSIONING.md](VERSIONING.md)。

## 当前接续入口（2026-10-27 更新）

最新开发成果在 **`feature/unify-local-env`**，功能提交为 `a341b7f`。`main` 与 `v0.11.0-alpha.1` 仍是较早发布快照。该功能分支已包含纯Web的 `/login`、`/accounts`、`/videos`，不能按分支名误认为只有环境配置修改。

首次获取最新功能，在 clone 后执行：

```powershell
git fetch origin --tags
git switch --track origin/feature/unify-local-env
```

已有同名本地分支时，先确认无未提交工作，再切到该分支并 `git pull --ff-only`。以后每次继续开发，先同步**当前跟踪分支**，不要直接按旧示例切回 main。

当前产品只做Web，新使用者无需安装或运行助手。启动 `npm run dev` 后从 `/login` 登录矩阵流，再进入账号管理与视频分析；需要本机根 `.env` 的 `MATRIX_OWNER_PASSWORD`，真实查询还需 `TIKHUB_API_KEY`。这些配置不会从另一台电脑随Git同步，详情见 [Web运行说明](VIDEO_ANALYTICS.md)。下文助手步骤是保留路径，不是新Web功能的必备前置条件。

新增 `/videos` 是独立的服务端视频查询业务，不需要助手/worker。配置TikHub密钥、管理密码后可单独运行Web；生产命令为 `npm run serve:videos`，配置与HTTPS部署见 [视频分析](VIDEO_ANALYTICS.md)。下文两个进程的启动方式仍针对本机账号报表助手。

## 1. 每台电脑独立准备

- Windows，已安装 Microsoft Edge；助手与浏览器夹具测试目前使用 `msedge` 渠道。
- Git for Windows（建议包含 Git Credential Manager），有权限访问私有仓库的 GitHub 账号。
- Node.js **22.21.0**、npm；最低 Node 要求为 22.13.0。仓库的 `.node-version` 和 `.nvmrc` 记录使用版本。
- 两台电脑各自有完整 clone，不共享正在运行的 `.data`、SQLite 或浏览器 profile。

若使用 nvm-windows，可按其方式安装并选择 `22.21.0`；不要假定 Windows 上的 `nvm use` 会自动读取 `.nvmrc`。没有版本管理器也可安装对应 Node。

## 2. 新电脑第一次获取代码

在你选择的开发目录执行：

```powershell
git clone https://github.com/fallenkobe/juzhenliu.git
cd juzhenliu
git fetch origin --tags
git status --short
git log -1 --oneline
npm ci
```

私有仓库首次 clone/fetch/push 可能要求浏览器授权。网页已登录或 Codex 已连接 GitHub，不代表命令行 Git 已拥有凭据；请按本机 Git Credential Manager 提示登录，不要把访问令牌写进 remote URL 或项目文档。

提交者身份可在该仓库单独配置，把示例换成自己的真实信息：

```powershell
git config user.name "你的 GitHub 用户名"
git config user.email "你的 GitHub 已验证邮箱或 noreply 邮箱"
```

默认助手路径不需要官方 OAuth 密钥。需要根 `.env` 时，仅在不存在的情况下从示例复制：

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

保留 `ALPHA_MODE=demo`。这个值控制原工作台的演示发布/投流，不能通过换成其他值启用真实服务。

## 3. 启动两个进程

终端 A，仓库根目录：

```powershell
npm run dev
```

此命令启动 Next Web 与独立 worker，默认 <http://127.0.0.1:3000>。

终端 B，同一个仓库根目录：

```powershell
npm run assistant
```

然后打开 <http://127.0.0.1:3000/assistant>：

1. 点击「打开登录窗口」，在助手启动的独立 Edge 中扫码。
2. 核对/填写账号备注并勾选自有账号确认。
3. 选择作品或粉丝的昨天、近 7 天、近 30 天，点击对应同步按钮。
4. 时间标签切换已保存结果；需要最新数据时显式同步。

新电脑需要重新扫码；旧电脑的浏览器、Codex 内浏览器与新电脑专用 Edge 不共享登录。新电脑首次没有历史采集数据属于正常状态。

不用开发服务器时，生产构建的本地启动方式为：

```powershell
npm run build
npm run preview
```

`preview` 同时启动 Web 与 worker，助手仍需另运行。当前执行脚本依赖 `tsx`，按完整 `npm ci` 安装，不使用 `--omit=dev` 作为现阶段启动方案。

## 4. 两台电脑日常交接

### 开始前：先同步再写代码

```powershell
git status --short
git fetch origin --tags
git switch main
git pull --ff-only origin main
```

仅在工作区没有未提交工作时执行切分支/更新。若有改动，先在原工作分支提交并推送，或明确整理好本机工作；不要用 reset、clean、覆盖文件来解决交接。

从更新后的 main 创建功能分支，例如：

```powershell
git switch -c feature/my-change
```

`feature/my-change` 是说明用的示例名，实际按本次任务命名。两台电脑尽量一次只在一台写同一个任务；并行做不同任务时使用不同分支，避免都直接修改共享 main。

### 离开电脑 A 前

1. 更新 `PROJECT_MEMORY.md`、`TODO.md`；有用户行为变化时更新 `CHANGELOG.md`。
2. 检查改动，按需要运行本地检查，记录哪些没有验证。
3. 只暂存本次任务的源码与文档。以下是示例，按实际改动调整路径：

```powershell
git diff --stat
git add packages/assistant/analysis.ts apps/web/components/period-analysis.tsx PROJECT_MEMORY.md TODO.md
git diff --cached --stat
git commit -m "feat: improve account analysis"
git push -u origin feature/my-change
```

功能尚未完成也需要转到另一台电脑时，可提交到自己的功能分支，并在提交说明和记忆里标注未完成项；不要把未完成工作混入稳定版本标签。只保存在本机的 stash 不会同步到另一台电脑。

### 在电脑 B 接续同一分支

```powershell
git fetch origin --tags
git switch --track origin/feature/my-change
npm ci
```

如果 B 上已经有这个本地分支，则改用：

```powershell
git switch feature/my-change
git pull --ff-only origin feature/my-change
npm ci
```

随后让新会话阅读根 `AGENTS.md` 和 `PROJECT_MEMORY.md`。完成任务后按团队实际方式合并 main；可以使用 GitHub PR 审阅，也可以在无分歧且符合本次授权时正常合并。不要强制推送共享 main，不覆盖现有版本标签。

若 `pull --ff-only` 提示分歧，先查看提交图、确认两台电脑各自的工作，再合并或按明确方案整理。不能把其中一台的提交直接丢弃。

## 5. Git 同步内容与本机独立内容

| 随 GitHub 同步 | 每台电脑独立保留 |
| --- | --- |
| 应用源码、锁文件、配置模板 | `.env` 及其他真实环境配置 |
| 项目记忆、TODO、版本记录 | SQLite 数据库与 WAL/SHM |
| 测试代码、架构和开发说明 | 独立 Edge profile、Cookie、登录态 |
| Git 分支、提交、明确推送的标签 | 助手配对 token、端口连接文件、进程 PID |
| 不含真实凭据的示例 | 真实导出 Excel、参考数据、快照、截图和运行日志 |

代码同步不等于运营数据同步。当前新电脑看不到旧电脑本地数据是设计边界；如果需要共享运营数据，应另行设计受控的数据同步或明确迁移流程，不能把 `.data/` 加入 Git。

不要用云盘实时共享正在使用的 SQLite/WAL 或浏览器 profile；并发进程和电脑各自的系统登录状态会导致冲突。

## 6. 环境变量及配置边界

| 配置 | 当前用途 |
| --- | --- |
| `ALPHA_MODE=demo` | 原演示业务模式，默认保留 |
| `PORT` | `dev` / `preview` 的 Web 端口，默认 3000 |
| `MATRIX_ROOT` | 显式指定仓库根目录，正常从根启动不必填写 |
| `MATRIX_DATA_DIR` | 自定义本机数据目录，Web/worker/助手必须一致 |
| `MATRIX_ASSISTANT_PORT` | 助手端口，默认 37211，Web 从连接文件读取实际端口 |
| `DATABASE_URL` | 选择尚未真实验收的 PostgreSQL 分支 |
| `DOUYIN_*` / `MATRIX_OWNER_PASSWORD` | 官方 OAuth 备选配置，助手本身不需要 |

Web、worker 与独立助手均读取仓库根目录 `.env`；`npm run dev` 在选择 `PORT` 前也读取该文件。终端中显式设置的同名环境变量优先。相对 `MATRIX_DATA_DIR` 以仓库根目录为基准；使用绝对路径时请填这台电脑自己的路径。不要复制旧电脑的绝对路径或 `connection.json`。完整启动验证范围见项目记忆。

## 7. 常用检查

```powershell
npm run typecheck
npm test
npm run build
```

浏览器 E2E 在独立 3100 端口和独立 `.data/e2e-*` 目录运行；确认该端口空闲：

```powershell
$env:E2E_PRODUCTION='1'
npm run test:e2e
Remove-Item Env:E2E_PRODUCTION
```

运行生产 E2E 前先 build。`npm test` 的助手用例会启动隔离的无头 Edge、使用本地页面夹具，不操作已扫码的真实账号。现有测试通过不能代替所有新周期的真实验收。

不因本文件列出命令而自动扩大用户当前授权范围。用户要求“先实现、不验证”时，记录未检查项；出现具体故障时围绕它做必要验证。

## 8. 常见排查

- **3000 打不开**：先确认 `npm run dev` / `preview` 是否运行。push/pull 不会启动服务。
- **助手离线**：确认终端 B 在仓库根运行、37211 未被其他进程占用、数据目录与 Web 一致。
- **同步按钮禁用**：检查登录状态、备注、自有账号确认；刷新后需要重新勾选，面板会说明原因。
- **切到近 7 天但没变**：时间标签只切换当前缓存，点击对应同步按钮获取数据；确认实际导出日期和更新时间。
- **日期/字段错误**：检查作品/粉丝区域和选择范围，保留原错误，不把错误报表静默标成成功。
- **找不到 Edge**：安装本机 Microsoft Edge；当前 helper 和核心浏览器夹具使用 `msedge`，不是自动下载的 Chromium。
- **Git dubious ownership**：确认确实是本人仓库后，仅信任该仓库的实际路径，避免全局通配信任。
- **SQLite experimental 提示**：已验证 Node 版本可能输出此警告；区分警告与真正的退出错误。

首次交接无需旧会话：从仓库根 `AGENTS.md` 开始，再读项目记忆即可。
