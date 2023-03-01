FROM docker-registry.vslinko.xyz/vslinko/nodejs:latest as builder
ADD . /imap-forward
WORKDIR /imap-forward
RUN npm ci

FROM docker-registry.vslinko.xyz/vslinko/nodejs:latest
COPY --from=builder /imap-forward /imap-forward
WORKDIR /imap-forward
ENTRYPOINT ["node", "server.mjs"]
EXPOSE 3000
VOLUME /imap-forward/data
