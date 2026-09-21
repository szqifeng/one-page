FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate && pnpm install --prod --frozen-lockfile
COPY server ./server
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "server/index.js"]
