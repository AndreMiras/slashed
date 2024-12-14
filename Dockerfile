FROM node:22

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src src
RUN npm run build

CMD [ "npm", "run", "prod"]
