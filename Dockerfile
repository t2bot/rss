FROM node:18
COPY . /app
WORKDIR /app
RUN npm i && npm run-script build
VOLUME /app/config
VOLUME /data
ENV NODE_ENV=production
CMD node /app/lib/index.js
