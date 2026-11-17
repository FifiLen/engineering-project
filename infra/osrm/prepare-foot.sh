#!/bin/sh
# Przygotowanie danych OSRM z profilem pieszym (trasa do hulajnogi, ADR 0048) z tego samego wycinka
# co profil rowerowy. Osobny katalog, bo osrm-extract zapisuje wynik obok pliku .osm.pbf.
# Wykonywane tylko raz: gdy dane są już przetworzone, skrypt kończy działanie.
set -e
DATA=/osrm/foot
NAME=slaskie-latest

if [ -f "$DATA/$NAME.osrm.mldgr" ]; then
  echo "Dane OSRM (pieszo) już przygotowane."
  exit 0
fi

mkdir -p "$DATA"
ln -sf "../data/$NAME.osm.pbf" "$DATA/$NAME.osm.pbf"
osrm-extract -p /opt/foot.lua "$DATA/$NAME.osm.pbf"
osrm-partition "$DATA/$NAME.osrm"
osrm-customize "$DATA/$NAME.osrm"
echo "Dane OSRM (pieszo) gotowe."
