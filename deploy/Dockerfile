# 构建阶段：装依赖 + 打包前后端
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci --workspace=client --workspace=server --workspace=shared --include-workspace-root
COPY shared/ shared/
COPY client/ client/
COPY server/ server/
RUN npm run build --workspace=client && npm run build --workspace=server

# 运行阶段：server 是 esbuild 全量打包的单文件，无需 node_modules
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/client/dist client/dist
COPY --from=build /app/server/dist server/dist
EXPOSE 3000
USER node
CMD ["node", "server/dist/index.js"]
