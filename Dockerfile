FROM node:18
COPY . /app
WORKDIR /app
RUN npm i && npm run-script build
VOLUME /app/config
VOLUME /data
CMD node /app/lib/index.js
