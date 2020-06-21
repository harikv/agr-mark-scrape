## agr-mark-scrape
Collection of scripts which use puppeteer to scrape data from [AgMarknet](http://agmarknet.gov.in/PriceAndArrivals/CommodityDailyStateWise_cat.aspx)

### Building
```
git clone <>
npm install
tsc
node compiled/index.js
```

### Notes
Stores status of the run in `data/status.json`
Aggregates data from all states for a given year.
Output files are created in `data/crop_data_{year}.csv`