# lgame-api SDK 协作规则

## 仓库边界

- 本仓库是 public npm 包 `lgame-api`，只包含客户端 TypeScript SDK 和公开接入文档。
- 源码在 `src/`，模块文档在 `docs/`，包入口和构建配置在根目录。
- 不得加入私有服务端、后台管理系统、数据库脚本、`.env`、密钥、token 或生产日志。
- 服务端接口变更由私有 `MoyooServers` 仓库先验证，再在本仓库同步类型、方法和文档。

## Git 推送规则

- SDK 的目标仓库是 `https://github.com/tyc19961996/lgame-api.git`，目标分支是 `main`。
- 当前共享 Git 配置中，GitHub SDK 远程名是 `lgame-api`；`origin` 指向私有 Gitee 服务端仓库，SDK 不应推送到 `origin/main`。
- 本地 `main` 应跟踪 `lgame-api/main`。推送前通过 `git branch -vv` 和 `git remote get-url --push lgame-api` 核对分支与目标地址。
- 推送 SDK 时显式执行 `git push lgame-api main`；不要依赖界面默认远程，不要使用 `git push --all` 或 `git push --mirror`。
- 如果跟踪分支被改成 `origin/main`，先执行 `git branch --set-upstream-to=lgame-api/main main` 修正，再核对推送目标。

## 语言要求

计划、设计、代码注释、README、接入文档和 Git 提交日志统一使用中文。协议字段、代码符号、npm 命令和公开 API 名称可以保留英文。

## 构建、测试和发布

```powershell
npm install
npm run build
npm test
npm publish
```

发布前必须先执行构建和测试，确认 `package.json` 的导出、类型声明和运行时模块格式没有回归。版本号按 npm 发布策略递增；不要在 public 包中写入服务端凭据。

## 修改范围

- API 方法、参数和响应类型：更新 `src/types.ts`、`src/LGameApi.ts` 或对应模块，并同步 `docs/`。
- HTTP、平台适配和初始化：保持 `LGameAPI.init` 的显式 `baseUrl` 约定，不把服务端地址写死到 SDK。
- 文档示例使用占位域名、占位 AppID 和公开字段，不出现真实密钥。
