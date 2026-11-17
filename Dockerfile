FROM node:22-alpine
WORKDIR /app
COPY package.json cli.js ./
COPY src ./src
ENV STATE_FILE=/data/state.json HOST=0.0.0.0 PORT=8787
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "cli.js", "serve"]
