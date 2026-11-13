#!/bin/bash

set -euo pipefail


web-ext lint
web-ext build --overwrite-dest
