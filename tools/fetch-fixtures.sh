#!/bin/sh
# Saves live answers of the two sources as test fixtures, and prints the moment they were taken.
# Usage: sh tools/fetch-fixtures.sh   (from the project's root)
set -e
F=tests/fixtures
mkdir -p "$F"
curl -s -m 10 "https://gpsgadget.buienradar.nl/data/raintext?lat=52.37&lon=4.89" -o "$F/raintext-amsterdam.txt"
curl -s -m 10 "https://gpsgadget.buienradar.nl/data/raintext?lat=52.52&lon=13.40" -o "$F/raintext-berlin.txt"
curl -s -m 10 --http1.0 "http://api.open-meteo.com/v1/forecast?latitude=52.37&longitude=4.89&hourly=precipitation&minutely_15=precipitation&models=knmi_seamless&forecast_hours=49&forecast_minutely_15=12&timeformat=unixtime" -o "$F/model-amsterdam.json"
date -u +%s > "$F/taken-at.txt"
wc -c "$F"/*
