const https = require('https');
const {name,version} = require('./package.json');
const ua = `rapidblocker/${version}`

const getBlocks = (server,apikey,min=0,limit=200) => {
    const url = new URL("api/v1/instance/domain_blocks",
            `https://${server}`)
    return new Promise((resolve,reject)=>{
        url.searchParams.append('limit',limit.toString())
        url.searchParams.append('min_id',min.toString())
        let opt = {
            headers: {
                'user-agent': ua
            }
        }
        if (apikey) opt.headers.authorization = `Bearer ${apikey}`
        let req = https.request(url,opt,(res) => {
            let body = "";

            res.on("data", (chunk) => {
                body += chunk;
            });

            res.on("end", () => {
                try {
                    let json = JSON.parse(body);
                    // do something with JSON
                    resolve(json)
                } catch (error) {
                    console.log(body)
                    console.error(error.message);
                    reject(error.message)
                };
            });

        }).on("error", (error) => {
            console.error(error.message);
            reject()
        }).end();
    })
}


const getAllBlocks = async (server,apikey = undefined)=>{
    let blocks = await getBlocks(server,apikey);
    let offset = 0;
    while(blocks.length >= offset) {
        offset = Math.max(...blocks.map(l=>parseInt(l.id)))
        let moreBlocks = await getBlocks(server,apikey,offset)
        for (let b of moreBlocks) {
            if (!blocks.find(bl=>bl.id==b.id)) {
                blocks.push(b)
            }
        }
    }
    return blocks
}

module.exports = getAllBlocks
