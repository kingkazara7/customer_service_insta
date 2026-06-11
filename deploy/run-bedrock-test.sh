#!/usr/bin/env bash
set -e
set -a
. /etc/partselect.env
set +a
cd ~/app/partselect-agent
node bedrock-test.js
