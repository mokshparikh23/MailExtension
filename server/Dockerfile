FROM node:20-alpine

WORKDIR /app

# Install production deps first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# App source
COPY . .

ENV PORT=3000
EXPOSE 3000

# Drop root
USER node

CMD ["node", "src/server.js"]
