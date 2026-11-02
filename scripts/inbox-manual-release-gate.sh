#!/bin/sh
set -eu
npm run test:inbox-triage-qa
npm run test:automation
npm run build:preview
