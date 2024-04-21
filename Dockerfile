FROM docker-registry.vslinko.xyz/vslinko/nodejs:latest
RUN mkdir /imap-forward
WORKDIR /imap-forward
COPY package.json package-lock.json /imap-forward/
RUN npm ci
COPY index.mjs server.mjs /imap-forward/
COPY lib/* /imap-forward/lib/
COPY data/config.example /imap-forward/data/
ENTRYPOINT ["node", "server.mjs"]
EXPOSE 3000
VOLUME /imap-forward/data
