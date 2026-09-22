# 贡献指南

欢迎提交问题、文档改进和 Pull Request。参与前请阅读 [LICENSE](LICENSE)：本项目采用非商业许可，贡献及其分发需遵守相应条款。请仅提交你有权提供的代码，并保留第三方作品所需的许可与版权声明。

## 开发环境

建议使用 Node.js 22、pnpm 8.15.9，与 Docker 和 CI 保持一致。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

前端需要 API 与 PostgreSQL。完整启动方式及环境配置见 [README](README.md) 和 [部署说明](docs/deployment.md)。不要将真实密码、令牌、Cookie、用户资料或数据库备份提交到仓库、Issue 或 PR。

## 目录约定

- `src/pages/`：页面与页面样式。
- `src/components/`：业务组件。
- `src/types/`、`src/utils/`：数据类型和业务工具。
- `server/`：API、鉴权与数据库访问。
- `tests/`：自动化测试。
- `docs/`：需求、部署及发布说明。
- `docker/`：反向代理等部署配置。

优先沿用现有技术栈。权限必须由服务端验证；涉及团队数据的查询和写入必须限定团队。调整数据模型时要兼容既有数据库和备份。

## 验证与提交

```bash
pnpm run setup
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node --check server/index.js
node --check server/db.js
docker compose config --quiet
```

涉及部署时还应运行 `docker compose build`；涉及业务流程时需验证实际操作和权限边界。请为有风险的行为变化补充测试，并同步需求或部署文档。

从最新 main 创建分支，一次 PR 聚焦一个目的。提交信息推荐使用 `feat:`、`fix:`、`docs:`、`test:` 或 `chore:` 前缀。PR 中说明问题、变化、验证结果和升级影响。不要提交依赖目录、构建产物或本地生成文件。

安全问题请遵循 [SECURITY.md](SECURITY.md)，不要公开漏洞细节。
