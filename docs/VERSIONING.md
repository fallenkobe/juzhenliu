# 版本管理约定

当前最新开发分支为 `feature/unify-local-env`，已推送功能基线 `a341b7f`。它在 `v0.11.0-alpha.1` 之后继续开发，尚未创建新发布标签，不能把 main/旧标签当作最新Web功能。

## 当前版本与基线

| 产品标识 | package.json 版本 | Git 标签 | 内容 |
| --- | --- | --- | --- |
| Alpha 0.01 | `0.0.1-alpha.1` | `v0.0.1-alpha.1` | 原本地演示工作台，基线提交 `7f0ccbb` |
| 0.11 Alpha | `0.11.0-alpha.1` | `v0.11.0-alpha.1` | 官方 OAuth 备选代码、本机助手、分周期分析、双机交接资料 |

此次为历史基线补充第一个标签，当前版本建立第二个标签。标签使用附注形式，并随指定分支显式推送；没有自动创建 GitHub Releases 页面。

`0.11.0-alpha.1` 表示当前 Alpha 快照，有明确未验收项，不代表生产可用。已知边界与实际检查见 `PROJECT_MEMORY.md`。

## 版本号如何变更

- 同一 0.11 功能阶段的后续修复/交接快照，可以递增为 `0.11.0-alpha.2`、`alpha.3`，每个新版本必须对应新标签。
- 进入新的功能阶段再调整次版本，如 `0.12.0-alpha.1`；实际版本由当次需求决定。
- 去除 Alpha 标记前，需有与声明能力相匹配的验收，不能仅因构建通过就称稳定。
- `package.json` 与 `package-lock.json` 的根版本保持一致。UI、README 和 CHANGELOG 的用户版本标识同时核对。
- 标签一经推送不得移动、覆盖或重用。修复已标记版本使用新提交、新版本号与新标签。

## 分支与提交

- `main`：两台电脑共享的主线；拉取使用 `--ff-only`，不强制覆盖远程。
- `feature/<主题>`、`fix/<主题>`、`docs/<主题>`：单个任务使用的短期分支。与另一台电脑交接时先提交并推送该分支。
- 提交信息优先使用 `feat:`、`fix:`、`docs:`、`test:`、`chore:`，说明实际变化。
- 有行为、范围或验收变化时，更新 `PROJECT_MEMORY.md` 与 `TODO.md`，必要时更新 CHANGELOG。
- 原始导出、profile、数据库、日志和密钥不参与版本提交。

## 发布一个新快照

1. 确认工作范围与已知限制；整理对应代码和文档。
2. 按当次任务运行必要检查，并在记忆中写清没有检查的范围。
3. 核对根 package / lock 版本、README、CHANGELOG。
4. `git fetch origin --tags`，检查远程分歧；只暂存本次实际要发布的路径，检查 staged diff 和忽略规则。
5. 创建提交，再创建**尚未存在**的附注标签。
6. 推送目标分支和该标签，核对远程提交和标签指向。

标签操作示例，版本号必须替换为当次已经决定的新版本：

```powershell
git tag -a v0.11.0-alpha.2 -m "MatrixFlow 0.11.0-alpha.2"
git push origin main refs/tags/v0.11.0-alpha.2
git ls-remote origin refs/heads/main "refs/tags/v0.11.0-alpha.2*"
```

这个示例不表示已创建 `alpha.2`。不要直接运行示例覆盖正在交接的版本。

## 查看或回到指定版本

查看：

```powershell
git fetch origin --tags
git tag --list
git log --oneline --decorate -10
git show --stat v0.11.0-alpha.1
```

需要查看历史源码时，在工作区干净且已保留当前工作后，可以：

```powershell
git switch --detach v0.11.0-alpha.1
```

需要在历史版本上试验修改，另建分支，不在 detached HEAD 中堆积要交接的工作：

```powershell
git switch -c review/alpha-0.11 v0.11.0-alpha.1
```

源码版本回退不会还原 `.data`、浏览器登录态或数据库迁移。要运行很旧的源码，优先使用另一个独立 checkout 和新的本机数据目录，保留原数据；不要直接删除用户数据来“修复版本”。
