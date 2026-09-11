FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY docs ./docs
COPY package.json ./
EXPOSE 3344
USER node
CMD ["node", "src/index.js"]
