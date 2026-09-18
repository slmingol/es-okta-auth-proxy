FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:24-alpine AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY docs ./docs
COPY package.json ./
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
EXPOSE 3344
USER node
CMD ["node", "--no-deprecation", "src/index.js"]
