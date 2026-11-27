FROM node:22-slim AS builder

WORKDIR /build

COPY packages/contracts/package.json packages/contracts/package-lock.json ./packages/contracts/
COPY packages/contracts/tsconfig.json ./packages/contracts/
COPY packages/contracts/src ./packages/contracts/src
RUN npm --prefix packages/contracts ci && npm --prefix packages/contracts run build

COPY services/authd/package.json services/authd/package-lock.json ./services/authd/
COPY services/authd/tsconfig.json ./services/authd/
COPY services/authd/src ./services/authd/src
RUN npm --prefix services/authd ci && npm --prefix services/authd run build

FROM arena-public-worker:local

USER root
WORKDIR /opt/authd

COPY --from=builder --chown=node:node /build/services/authd/dist ./dist
COPY --from=builder --chown=node:node /build/services/authd/package.json ./package.json
COPY --from=builder --chown=node:node /build/packages/contracts/package.json ./node_modules/@arena/contracts/package.json
COPY --from=builder --chown=node:node /build/packages/contracts/dist ./node_modules/@arena/contracts/dist
COPY --from=builder --chown=node:node /build/packages/contracts/node_modules/zod ./node_modules/zod

RUN mkdir -p /auth/antigravity-home && chown -R node:node /auth

USER node

EXPOSE 4311

CMD ["node", "/opt/authd/dist/index.js"]
