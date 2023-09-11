const https = require('https');
const Readable = require('stream').Readable;
const csvParser = require("csv-parser");
const {name,version} = require('./package.json');
const ua = `rapidblocker/${version}`

const getListCSV = (uri) => {
    const url = new URL(uri)
    return new Promise((resolve,reject)=>{
        const opt = {
            headers: {
                'user-agent': ua
            }
        }
        let req = https.request(url,opt,(res) => {
            let body = "";

            res.on("data", (chunk) => {
                body += chunk
            });

            res.on("end", () => {
                try {
                    let list = []
                    Readable.from(body).pipe(csvParser({headers: false})).on('data',data=>list.push(data)).on('end',()=>resolve(list))
                } catch (error) {
                    console.error(error.message);
                    reject(error.message)
                };
            });

        }).on("error", (error) => {
            console.error(error.message);
            reject(error)
        }).end();
    })
}

module.exports = getListCSV
