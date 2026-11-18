#!/bin/sh
# Saves live answers of the forecast service as test fixtures: one for a place both models reach, one for a
# place only the model by the hour reaches. The tests check their shape, not their weather.
# Usage: sh tools/fetch-fixtures.sh   (from the project's root)
set -e
F=tests/fixtures
ASK="timeformat=unixtime&models=knmi_seamless,icon_d2&hourly=precipitation&forecast_hours=49&minutely_15=precipitation&forecast_minutely_15=24"
mkdir -p "$F"
curl -s -m 15 --http1.0 "http://api.open-meteo.com/v1/forecast?latitude=52.09&longitude=5.12&$ASK" -o "$F/forecast-utrecht.json"
curl -s -m 15 --http1.0 "http://api.open-meteo.com/v1/forecast?latitude=40.42&longitude=-3.70&$ASK" -o "$F/forecast-madrid.json"
wc -c "$F"/*
