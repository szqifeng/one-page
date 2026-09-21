FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml .umirc.ts tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY jest.config.js .eslintrc.cjs .stylelintrc.cjs ./
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate && pnpm install --frozen-lockfile
RUN pnpm build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
