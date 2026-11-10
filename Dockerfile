# The zero-token workflow studio, for a public host such as Railway. It calls no model and needs no keys.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci && node scripts/studio.mjs --build-only && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production STUDIO_HOSTED=1 NORTHWIND_ROOT=/app
# undici stays outside the bundle, so it comes from node_modules.
COPY --from=build /app/node_modules/undici ./node_modules/undici
COPY --from=build /app/runs/studio/server.mjs ./runs/studio/server.mjs
COPY --from=build /app/packages/studio/public ./packages/studio/public
COPY --from=build /app/packages/studio/workflows ./packages/studio/workflows
USER node
CMD ["node", "runs/studio/server.mjs"]
