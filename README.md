# 季度双周滚动规划看板

一个面向混合型团队的一页纸规划工具：用季度视角管理总投入，用双周视角管理近期承诺，并持续观察每个人的 DPO 与日常需求容量。采用 Umi Max + React、Express 和 PostgreSQL，支持 Docker Compose 部署。

## 当前能力

- 保留参考包的 7 轮双周规划、交付内容/人天分列和明细表
- DPO / 日常需求分类与筛选
- 迭代投入、季度投入、单人投入和事项投入分析
- 每轮人员容量、每个人独立的 DPO / 日常比例预算和超载预警
- 新增、编辑、删除事项以及跨双周的交付与人天分配
- DPO / 日常事项统一维护 0–100% 完成进度
- 创建和切换独立季度，每个自然年最多 3 个季度并自动生成双周迭代
- 迭代按周一至周五的实际工作日生成，标准双周为 10 个工作日，短迭代自动折算人员容量
- 人员类型维护：开发、运营、产品，可继续新增和停用
- 人员维护：账号、类型、状态、容量、日常占比和权限角色
- 权限角色维护：管理员、规划负责人、普通成员和自定义角色
- 权限实际约束规划编辑、本人事项、人员、类型和角色维护操作
- PostgreSQL 持久化、版本号乐观锁和规划变更审计
- 团队级数据隔离，可在顶部创建团队并在本人已加入的团队间切换
- 服务端登录会话和用户行为日志
- 每日三个定时规划备份，恢复入口展示最近 50 份
- 可通过环境变量配置账号密码、OAuth2 或双模式登录
- OAuth2 profile 接口默认读取 `email`，并取 `@` 前部分作为账号名
- OAuth2 新用户可自动创建，但默认绑定“未授权用户”角色，不自动获得团队权限

## 本地开发

```bash
pnpm install
pnpm dev

# 另开终端启动 API（需要本机 PostgreSQL）
DATABASE_URL=postgres://planner:planner@localhost:5432/rolling_plan \
BOOTSTRAP_ADMIN_PASSWORD='replace-me' pnpm server
```

默认访问 `http://localhost:8000`。

默认管理员账号为 `admin`，密码由 `BOOTSTRAP_ADMIN_PASSWORD` 配置。开发环境可使用默认值 `ChangeMe123!`，生产环境必须覆盖。

## Docker 部署

```bash
cp .env.example .env
# 修改数据库密码、管理员密码和 OAuth2 配置
docker compose up -d --build
```

访问 `http://localhost`。Compose 会启动 PostgreSQL、API 和 Nginx 前端；数据库数据保存在 `postgres_data` 卷中。

## 登录方式配置

通过 `AUTH_MODE` 控制：

- `local`：仅账号密码登录
- `oauth2`：仅 OAuth2 单点登录
- `both`：两种登录方式都支持

OAuth2 需要配置 `OAUTH2_AUTHORIZATION_URL`、`OAUTH2_TOKEN_URL`、`OAUTH2_PROFILE_URL`、`OAUTH2_CLIENT_ID`、`OAUTH2_CLIENT_SECRET` 和回调地址。服务端调用 profile 接口后读取 `OAUTH2_EMAIL_FIELD`（默认 `email`），例如 `xx@aa.com` 会使用 `xx` 作为团队账号。设置 `OAUTH2_AUTO_PROVISION=true` 后，不存在的用户会自动创建并绑定 `role-no-access`，由管理员后续授权。

系统以团队为数据隔离边界：规划、团队内角色、备份和行为日志均关联 `team_id`，一个登录用户可加入多个团队。顶部团队选择器只展示当前用户已加入的团队；用户创建团队后自动成为该团队管理员并切换进入。具备权限管理权限的管理员可以在“团队与权限 → 行为日志”查看用户的登录、退出、规划读写和 API 操作记录。

详细文档：

- [需求说明](docs/requirements.md)
- [Docker 部署说明](docs/deployment.md)
- [贡献指南与目录约定](CONTRIBUTING.md)
- [安全问题反馈](SECURITY.md)
- [变更记录](CHANGELOG.md)
- [发布流程](docs/releasing.md)

## 验证

```bash
pnpm run setup
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

GitHub Actions 会在 main 推送和 Pull Request 时执行检查与 Docker 镜像构建。首次开发建议使用 Node.js 22 和 pnpm 8.15.9。

服务端会根据登录用户、所属团队和规划中的角色再次校验权限；前端按钮控制不能替代服务端鉴权。规划写入使用版本号乐观锁，避免多人同时编辑时静默覆盖。

## 许可协议

本项目采用 [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)：允许在协议范围内用于个人学习、研究、评估、非营利组织等非商业用途，并允许相应的复制、修改和分发；任何商业使用都需要事先取得著作权人的书面授权。

该协议属于“源码可用、禁止商业使用”许可，不是 OSI 认可的开源协议。完整声明见 [LICENSE](LICENSE)。
