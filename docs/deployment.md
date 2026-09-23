# Docker 部署说明

## 1. 环境要求

- Docker Engine 24+
- Docker Compose v2
- 可访问 PostgreSQL、镜像仓库以及 OAuth2 服务（启用 SSO 时）

## 2. 配置

```bash
cp .env.example .env
```

生产环境至少需要修改：

```dotenv
POSTGRES_PASSWORD=随机强密码
BOOTSTRAP_ADMIN_PASSWORD=随机强密码
DEFAULT_TEAM_NAME=实际团队名称
AUTH_MODE=local
BACKUP_TIMES=02:00,10:00,18:00
BACKUP_TIMEZONE=Asia/Shanghai
```

启用 OAuth2 时配置：

```dotenv
AUTH_MODE=oauth2
OAUTH2_AUTHORIZATION_URL=https://sso.example.com/oauth2/authorize
OAUTH2_TOKEN_URL=https://sso.example.com/oauth2/token
OAUTH2_PROFILE_URL=https://sso.example.com/oauth2/userinfo
OAUTH2_CLIENT_ID=your-client-id
OAUTH2_CLIENT_SECRET=your-client-secret
OAUTH2_REDIRECT_URI=https://planning.example.com/api/auth/oauth2/callback
OAUTH2_EMAIL_FIELD=email
OAUTH2_AUTO_PROVISION=true
OAUTH2_DEFAULT_ROLE_ID=role-no-access
```

## 3. 启动与升级

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://localhost/api/health
```

升级代码后执行：

```bash
git pull
docker compose up -d --build
```

数据库结构在 API 启动时执行幂等初始化。PostgreSQL 数据保存在 `postgres_data` 卷中，重建容器不会删除数据卷。

## 4. 登录

本地登录模式的初始管理员账号为 `admin`，密码取自 `BOOTSTRAP_ADMIN_PASSWORD`。首次登录并初始化规划后，应立即使用安全的生产配置。

OAuth2 模式下，profile 返回的 `email` 如为 `xx@aa.com`，系统账号为 `xx`。首次自动创建的用户没有团队权限，需要管理员授权并维护对应人员信息。

## 5. 备份与恢复

每次保存均在同一事务内追加完整历史版本，另有每日三次定时快照。在“版本历史”中每页查看 50 条，权限管理员可恢复。历史不自动清理，应监控数据库容量；这些同库快照不能替代下述独立数据库备份。

应用快照不能替代数据库灾备。生产环境还应对 PostgreSQL 执行独立备份，例如：

```bash
docker compose exec -T db pg_dump -U planner -d rolling_plan -Fc > rolling_plan.dump
```

恢复数据库前应停止写入并先备份当前数据库。

## 6. 运维检查

```bash
docker compose ps
docker compose logs --tail=200 api
docker compose logs --tail=200 web
curl -fsS http://localhost/api/health
```

常见问题：

- 前端提示无法连接服务端：确认 API 容器健康且 Nginx `/api` 代理可达。
- 登录失败：检查 `AUTH_MODE` 与相应登录环境变量。
- OAuth2 回调失败：检查回调地址是否与 SSO 平台登记地址完全一致。
- 没有操作权限：检查用户是否已关联团队人员及权限角色。
- 没有备份：确认团队规划已初始化，并检查 `BACKUP_TIMES`、`BACKUP_TIMEZONE` 和 API 日志。
