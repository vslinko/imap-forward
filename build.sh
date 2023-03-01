#!/bin/bash

set -e

docker build . --tag docker-registry.vslinko.xyz/vslinko/imap-forward:latest
docker push docker-registry.vslinko.xyz/vslinko/imap-forward:latest
