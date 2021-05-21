const fs = require('fs');
const path = require('path');
const _ = require('underscore');
const csv = require('csvtojson');
require('console.table');

const d = new Date();
const currentYear = String(d.getFullYear()).substr(2,4);
let currentYearProfit = 0;
let grandTotal = 0;

const config = require('./config.js');
const shops = config.shops;
const targetDir = config.targetDir;
const currencySym = config.currencySymbol;
const salesReportTopListCount = config.salesReportTopListCount;
const targetDirFiles = fs.readdirSync(targetDir);


getArtistSalesReports().then(reports => {

    return _.sortBy(reports, filePath => {
        return createdDate(filePath)            
    }).reverse();

}).then(reports => {
    
    return Promise.all(shops.map(async shop => {
        return matchReport(shop, reports);
    })).then(data => {
        return data
    });
        
}).then(reportsByShop => {

    return Promise.all(reportsByShop.map(async shop => {
        return mergeReportsReturnOrders(shop);
    })).then(data => {
        return data
    })

}).then(ordersByShop => {
    
    renderSalesReport(ordersByShop);

}).catch(e => {
    console.log('error: ' + e);
});

function renderSalesReport(result) {

    result.forEach(shopObj => {

        grandTotal += Number(shopObj.orders.reduce((memo, obj) => { return memo + Number(obj['Artist Margin (USD)']) }, 0).toFixed(2));

        var salesTable = [
            { 'type' : 'Retail Sales', 'fieldName' : 'Retail Price (USD)' },
            { 'type' : 'Manufacturing Fees', 'fieldName' : 'Manufacturing Price (USD)' },
            { 'type' : 'Artist Margin', 'fieldName' : 'Artist Margin (USD)'  },
            { 'type' : 'Average Sale', 'fieldName' : 'Artist Margin (USD)'  }
        ].map(row => {
            let total = shopObj.orders.reduce((memo, obj) => { 
                return memo + Number(obj[row.fieldName]) 
            }, 0).toFixed(2);
            
            if (row.type === 'Average Sale') {
                total = (total/shopObj.totalOrders).toFixed(2);
            } 

            return {
                'type' : row.type,
                'total' :  currencySym + total
            }
        });

        console.log("Shop : " + shopObj.name);

        console.log("Quantity Sold:           " + shopObj.totalOrders + "\n");

        console.table(salesTable);

        sortByYear(shopObj);

        console.table(reducePercent(shopObj.orders, shopObj.totalOrders, "Product"));
        console.table(reducePercent(shopObj.orders, shopObj.totalOrders, "Destination Country"));
        // console.table(reducePercent(shopObj.orders, shopObj.totalOrders, "Destination State"));
        console.table(reducePercent(shopObj.orders, shopObj.totalOrders, "Work", salesReportTopListCount));
        console.table(reducePercent(shopObj.orders, shopObj.totalOrders, "Status"));

    });

    // passing false triggers the final report at the end
    sortByYear(false);

}

let cumulativeSalesArr = [];

function sortByYear(shopObj) {


    if (shopObj) {

        let orders = shopObj.orders;

        let ordersByYear = _.groupBy(orders, order => {
            return order['Order Date'].split(' ')[2]
        });
    
        let yearsObj = {
                'name' : shopObj.name,
                'yearsTable' : []
            };
    
        for (const [key, value] of Object.entries(ordersByYear)) {
    
            var yearTitle = "20" + `${key}`;
            let yearTotalSales = 0;
    
            ordersByYear[`${key}`].forEach(order => {
                yearTotalSales += Number(order['Artist Margin (USD)']);
            });
    
            yearsObj['yearsTable'].push({ 'year' : yearTitle, 'profit' : currencySym + yearTotalSales.toFixed(2) });
    
            if (`${key}` === currentYear) {
                currentYearProfit += yearTotalSales;
            }
    
        }

        cumulativeSalesArr.push(yearsObj);

        // console.log(yearsObj.name);
        // console.table(yearsObj.yearsTable);

    } else {
        
        let salesTotalsArr = [];

        cumulativeSalesArr.forEach(shop => {
            shop.yearsTable.forEach(year => {

                // console.log(salesTotalsArr.filter(recordedYear => recordedYear.year === year.year).length);
                if (salesTotalsArr.filter(recordedYear => recordedYear.year === year.year).length) {
                    // console.log("found the year" + year.year);
                    salesTotalsArr.find(recordedYear => recordedYear.year === year.year)[shop.name] = year.profit;

                } else {
                    let yearObj = {};
                    yearObj['year'] = year.year;
                    yearObj[shop.name] = year.profit;
                    salesTotalsArr.push(yearObj);
                }




            }); 
        });

        console.log("Profits By Year");
        console.log(salesTotalsArr);
        console.table(salesTotalsArr);

        /**
        // show a cumulative total only in case of multiple shops
        if (shops.length > 1) {
            console.log("current year(20" + currentYear + ") profit: " + currencySym + currentYearProfit.toFixed(2));
            console.log("total profit: " + currencySym + grandTotal.toFixed(2));
        }
        */
    }


}

async function getArtistSalesReports() {
    const artistSalesReports = await Promise.all(targetDirFiles.map(async filename => {

        let filePath = path.join(targetDir + '/' + filename);

        if (!fs.lstatSync(filePath).isDirectory() && 
            filePath.indexOf('.csv')>=0 && 
            filePath.substr(targetDir.length+1,20) === "artist-sales-report-") {
            return filePath
        }

    }));

    return artistSalesReports.filter( Boolean );
}

async function matchReport(shop, reports) {
    
    const matches = await Promise.all(reports.map(async filePath => {
       
        const reportData = await csv().fromFile( filePath );

        if (reportData[0]['Work'].match(shop.productRegex)) {
            return filePath;
        }
        
    }));
    
    return {
        'name': shop.name,
        'reports': matches.filter( Boolean )
    };
    
}

async function mergeReportsReturnOrders(shop) {

    let orders = [];
    let totalOrders = 0;

    await Promise.all(shop.reports.map(async (filePath, index) => {

        const csvData = await csv().fromFile( filePath );

        await csvData.map(async order => {

            let isDupe = orders.find(pastOrder => {
                return order['Order #'] === pastOrder['Order #'] && pastOrder['Report #'] !== index
            });

            if (!isDupe && order['Status'] !== "cancelled") {
                totalOrders += Number(order['Quantity']);
                order['Report #'] = index;
                orders.push(order);
            }
        })

    }));

    return {
        'name' : shop.name,
        'orders' : orders,
        'totalOrders' : totalOrders
    }

}

function createdDate(file) {  
    const { birthtime } = fs.statSync(file);
    return birthtime
}

function reducePercent(orders, shopTotalOrders, field, limit) {

    var queryGroup = _.groupBy(orders, obj => {
        return obj[field];
    });

    var result = [];
    const queryGroupKeys = _.keys(queryGroup);
    queryGroupKeys.forEach(key => {

        var obj = {};
        obj['sold'] = queryGroup[key].reduce((s, f) => { return s + Number(f.Quantity) }, 0);
        obj['pct'] = ((obj.sold/shopTotalOrders)*100).toFixed(1) + "%";
        obj['earnings'] = currencySym + queryGroup[key].reduce((s, f) => { return s + Number(f['Artist Margin (USD)']) }, 0).toFixed(2);
        if (Number.isInteger(limit) && 
            limit > 0) {
            obj[field + ' (Top ' + limit + ')'] = key
        } else {
            obj[field] = key;
        }
        
        result.push(obj);
    });

    result = _.sortBy(result, obj => { return Number(obj['earnings'].substr(1)) }).reverse();
    
    return limit ? result.slice(0, limit) : result;

}
