# syntax=docker/dockerfile:1
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY --from=build /app/node_modules/tsx ./node_modules/tsx
EXPOSE 3210
VOLUME ["/app/data"]
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/index.ts"]
