#!/bin/sh
# Przygotowanie danych OSRM dla województwa śląskiego (wycinek Geofabrik pobiera osrm-download).
# Wykonywane tylko raz: gdy dane są już przetworzone, skrypt kończy działanie.
set -e
DATA=/osrm/data
NAME=slaskie-latest

if [ -f "$DATA/$NAME.osrm.mldgr" ]; then
  echo "Dane OSRM już przygotowane."
  exit 0
fi

osrm-extract -p /opt/bicycle.lua "$DATA/$NAME.osm.pbf"
osrm-partition "$DATA/$NAME.osrm"
osrm-customize "$DATA/$NAME.osrm"
echo "Dane OSRM gotowe."
