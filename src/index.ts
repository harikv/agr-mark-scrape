import * as puppeteer from 'puppeteer';
import * as csv from 'fast-csv';
import * as fs from 'fs';
import * as _ from 'lodash';
import {performance} from 'perf_hooks';

const initBrowser = async (): Promise<puppeteer.Browser> => {
    console.log('Setting up Browser...');
    const options: puppeteer.LaunchOptions = {
        headless: true,
        timeout: 0,
        defaultViewport: null         
    };
    const browser: puppeteer.Browser = await puppeteer.launch(options);
    return browser;
};

const initPage = async (browser: puppeteer.Browser): Promise<puppeteer.Page> => {
    const page = await browser.newPage();
    page.on('console', (consoleMessageObject) => {
        if (consoleMessageObject.type() !== 'warning') {
            console.debug(consoleMessageObject.text())
        }
    });
    return page;
}

interface DateObj {
    month: string,
    day: number,
    year: number
}

interface StateStatus {
    completed: DateObj[]    
}

interface Status {
    [index: string]: StateStatus
}

interface DataRow extends DateObj {
    state: string,    
    group: string,
    crop: string,
    market: string,
    arrivals: number | 'NR',
    unit_arrival: string,
    variety: string,
    minprice: number,
    maxprice: number,
    modalprices: number,
    unit_price: string  
}

const extractData = async (state: string, day: number, month: string, year: number): Promise<DataRow[] | null> => {
    try {
        // Store valid date here
        const pageData: DataRow[] = [];
        // Get all rows in the table;
        const tableRows = document.querySelectorAll('table#cphBody_gridRecords > tbody > tr');
        if (tableRows.length > 0) {
            // Store certain variables
            let current_group: string = undefined;
            let current_crop: string = undefined;
            let current_market: string = undefined;
            let current_arrivals: number | "NR" = undefined;
            for (const row of tableRows) {
                // Check if row is valid
                const columns = row.querySelectorAll('td');
                if (columns.length > 0) {
                    // Check if row is indicating group
                    if (columns.length == 1) {
                        const row_content = columns[0].innerText;
                        if (row_content.match(/Group:[\w]+/) !== null) {
                            current_group = row_content;
                        }
                        else {
                            current_crop = row_content
                        }
                    }
                    // Otherwise extract required data
                    if (columns.length == 8) {
                        const market = columns[0].innerText;
                        const arrivals = columns[1].innerText;
                        if (market !== '') {
                            current_market = market;
                        }
                        if (arrivals !== '') {
                            if (arrivals !== 'NR') {
                                current_arrivals = Number(arrivals);
                            } else {
                                current_arrivals = 'NR';
                            }
                        }
                        pageData.push({
                            day: day,
                            month: month,
                            year: year,
                            state: state,
                            group: current_group,
                            crop: current_crop,
                            market: current_market,
                            arrivals: current_arrivals,
                            unit_arrival: columns[2].innerText,
                            variety: columns[3].innerText,
                            minprice: Number(columns[4].innerText),
                            maxprice: Number(columns[5].innerText),
                            modalprices: Number(columns[6].innerText),
                            unit_price: columns[7].innerText
                        })
                    }
                }
            }
            return pageData;
        } else {
            return [];
        }
    } catch (err) {
        console.log(`Error while evaluating page: ${err}`);
        return null;
    }
}

const getAvailableDays = async(browser: puppeteer.Browser, state: string, month: string, year: number): Promise<DateObj[]> => {
    // Get all days that have data
    const availableDays: DateObj[] = [];
    const page = await initPage(browser);
    try {        
        // Visit Website
        await page.goto('http://agmarknet.gov.in/PriceAndArrivals/CommodityDailyStateWise_cat.aspx');    
        // Enter state
        await page.waitForSelector('#cphBody_cboState');    
        await page.select('#cphBody_cboState', state);        
        // Enter month
        await page.waitForSelector('#cphBody_cboMonth');
        await page.select('#cphBody_cboMonth', month);    
        // Enter year
        await page.waitForSelector('#cphBody_cboYear');
        await page.select('#cphBody_cboYear', year.toString());
        const monthObj = {
            month: month,
            year: year
        };
        // Wait for calendar to load
        await page.waitForFunction( (monthObj) => {
            const calendarTitleElem = document.querySelector('#cphBody_Calendar1 > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1)');
            if (calendarTitleElem !== null) {
                const calendarTitle = calendarTitleElem.textContent;
                return calendarTitle === `${monthObj.month} ${monthObj.year}`;
            } else {
                return false;
            }
        }, {}, monthObj);            
        const dayLinkDays = await page.$$eval('#cphBody_Calendar1 > tbody > tr > td > a', (elems) => {
            return elems.map( (elem) => {
                return Number(elem.textContent);
            })
        });
        for (const day of dayLinkDays) {
            availableDays.push({
                day: day,
                month: month,
                year: year
            });
        }
        return availableDays;
    } catch (error) {
        console.log(`Error while getting Available days for ${state} ${month} ${year}`);
        console.log(error);
        return availableDays;
    } finally {
        await page.close();           
    }
}

const crawl = async (browser: puppeteer.Browser, state: string, date: DateObj, filePath: string): Promise<boolean> => {
    console.log(`Getting data for ${date.day} ${date.month} ${date.year} for state: ${state}`);               
    const page = await initPage(browser);
    try {
        // Visit Website
        await page.goto('http://agmarknet.gov.in/PriceAndArrivals/CommodityDailyStateWise_cat.aspx');    
        // Enter state
        await page.waitForSelector('#cphBody_cboState');    
        await page.select('#cphBody_cboState', state);    
        // Enter month
        await page.waitForSelector('#cphBody_cboMonth');
        await page.select('#cphBody_cboMonth', date.month);    
        // Enter year
        await page.waitForSelector('#cphBody_cboYear');
        await page.select('#cphBody_cboYear', date.year.toString());    
        const monthObj = {
            month: date.month,
            year: date.year
        };
        // Wait for calendar to load
        await page.waitForFunction( (monthObj) => {
            const calendarTitleElem = document.querySelector('#cphBody_Calendar1 > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1) > table:nth-child(1) > tbody:nth-child(1) > tr:nth-child(1) > td:nth-child(1)');
            if (calendarTitleElem !== null) {
                const calendarTitle = calendarTitleElem.textContent;
                return calendarTitle === `${monthObj.month} ${monthObj.year}`;
            } else {
                return false;
            }
        }, {}, monthObj);    
        // Get all days that have data
        const dayLinkElems = await page.$$('#cphBody_Calendar1 > tbody > tr > td > a');
        const dayLinkDays = await page.$$eval('#cphBody_Calendar1 > tbody > tr > td > a', (elems) => {
            return elems.map( (elem) => {
                return Number(elem.textContent);
            })
        });   
        const dayLinkObjs = _.zipObject(dayLinkDays, dayLinkElems);    
        // const dayLinks = await page.$$eval('#cphBody_Calendar1 > tbody > tr > td > a', (elems) => { 
        //     return elems.map((elem) => { 
        //         return elem.getAttribute('href')
        //     }) 
        // });    
        // console.log(dayLinks);
        // Visit required day
        const reqdDay: puppeteer.ElementHandle<Element> | null = _.get(dayLinkObjs, date.day, null);
        if (reqdDay === null) {
            return false;
        }    
        reqdDay.click();
        // Click to view report
        try {
            await page.waitFor('#cphBody_btnSubmit', { timeout: 10000 });
        } catch (buttonNotFoundErr) {
            console.log(`Unable to find data for ${state} ${date.day} ${date.month} ${date.year}`);
            console.log(buttonNotFoundErr);
            await page.close();
            return false;
        }
        await page.click('#cphBody_btnSubmit');
        // Construct payload for context and obtain data from the page
        await page.waitFor('table#cphBody_gridRecords');
        const extractedData = await page.evaluate(extractData, state, date.day, date.month, date.year);        
        if (extractedData !== null) {        
            // Store data in file
            const ws = fs.createWriteStream(filePath, { flags: 'a' });
            csv.write(extractedData, {headers: true, writeHeaders: false}).pipe(ws);
            ws.write('\n');
            await page.close();          
            // Go back
            // await page.waitFor('#cphBody_btnBack');
            // await page.waitFor(10000);            
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.log(`Error while crawling for ${state} ${date.day}  ${date.month} ${date.year}`);
        console.log(error);
        await page.close();
        return false;
    }
};

const main = async () => {
    // Load status from file
    const fileContent = await fs.readFileSync('data/status.json', 'utf8');    
    const fileData: Status = JSON.parse(fileContent);
    const browser = await initBrowser();
    // Create list of states
    const states: string[] = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chattisgarh", "Dadra and Nagar Haveli", "Daman and Diu", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "NCT of Delhi", "Odisha", "Pondicherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttrakhand", "West Bengal"];
    const months: string[] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const years = [2015, 2016, 2017];
    
    for (const state of states) {
        const stateStatus = _.get(fileData, state, {
            completed: []
        });
        for (const year of years) {
            const filePath = `data/crop_data_${year}.csv`;            
            console.log(`Crawling ${state}...`);                                              
            // Crawl all months
            for (const month of months) {
                // Get all days which have data                
                console.log(`Getting valid days for month: ${month} ${year} for state: ${state}`);                
                const availableDays = await getAvailableDays(browser, state, month, year);         
                console.log(`Found ${availableDays.length} days for ${month} ${year} for state: ${state}`);
                // Temporarily restrict availableDays to 2 days for easier crawling;
                // const tempDays = [availableDays[0]];
                for (const dateObj of availableDays) {
                // for (const dateObj of tempDays) {
                    if (_.find(stateStatus.completed, dateObj) === undefined) {
                        const timeStart = performance.now();
                        const dayStatus = await crawl(browser, state, dateObj, filePath);
                        const timeEnd = performance.now();
                        console.log(`Crawl took ${timeEnd - timeStart} ms`);
                        if (dayStatus === true) {
                            stateStatus.completed.push(dateObj);                                    
                        }                                
                    }
                    fileData[state] = stateStatus;
                    fs.writeFileSync('data/status.json', JSON.stringify(fileData))
                }                                       
            }
            fileData[state] = stateStatus;            
            fs.writeFileSync('data/status.json', JSON.stringify(fileData))                                    
        }   
    }
    console.log('Closing Browser...');
    await browser.close();
    // Write status to file
    fs.writeFileSync('data/status.json', JSON.stringify(fileData))
};

main();