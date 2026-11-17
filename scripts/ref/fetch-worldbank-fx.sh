#!/bin/sh
# Fetch step of the monthly World Bank exchange-rate refresh (see
# refresh-worldbank-fx.ts). Asks the World Bank when World Development
# Indicators was last updated; when <dir>/<lastupdated>/ does not exist yet,
# saves PA.NUS.FCRF (local currency units per US dollar, annual average) there
# with its SHA-256. Otherwise does nothing. Run on the first of every month.
#   sh scripts/ref/fetch-worldbank-fx.sh <dir>
set -eu
DIR=${1:?usage: fetch-worldbank-fx.sh <dir>}
API=https://api.worldbank.org/v2
LAST=$(curl -fsS --max-time 60 "$API/sources/2?format=json" | sed -n 's/.*"lastupdated":"\([0-9-]*\)".*/\1/p')
case "$LAST" in
[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
*) echo "World Bank API did not return a last-updated date" >&2; exit 1 ;;
esac
if [ -f "$DIR/$LAST/PA.NUS.FCRF.json" ]; then
	echo "up to date: WDI $LAST already saved"
	exit 0
fi
mkdir -p "$DIR/$LAST"
URL="$API/country/all/indicator/PA.NUS.FCRF?format=json&date=1960:$(date -u +%Y)&per_page=20000"
curl -fsS --max-time 300 "$URL" -o "$DIR/$LAST/PA.NUS.FCRF.json.part"
mv "$DIR/$LAST/PA.NUS.FCRF.json.part" "$DIR/$LAST/PA.NUS.FCRF.json"
(cd "$DIR/$LAST" && shasum -a 256 PA.NUS.FCRF.json > SHA256SUMS)
printf '{"url":"%s","lastupdated":"%s","fetched":"%s"}\n' "$URL" "$LAST" "$(date -u +%Y-%m-%d)" > "$DIR/$LAST/FETCH.json"
echo "saved WDI $LAST to $DIR/$LAST"
