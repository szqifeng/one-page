import { defineConfig } from '@umijs/max';

export default defineConfig({
  antd: {},
  model: {},
  initialState: {},
  request: {},
  npmClient: 'pnpm',
  title: '季度滚动规划',
  favicons: [],
  routes: [{ path: '/', component: 'index' }],
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    },
  },
  metas: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    {
      name: 'description',
      content: '按季度、双周、人员与事项统一查看团队投入的滚动规划看板',
    },
  ],
});
