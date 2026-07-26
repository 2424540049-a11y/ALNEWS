FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./server.js
COPY public ./public

EXPOSE 8787
CMD ["npm", "start"]
