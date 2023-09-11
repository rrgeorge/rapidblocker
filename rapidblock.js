#!/usr/bin/env -S node --no-warnings
const {name,version} = require('./package.json');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs');
const configpath = path.join(os.homedir(),`.${name}`,'config.js')
const cachepath = path.join(os.homedir(),`.${name}`,'cache.json')
const config = (() => {
    try {
        const config = require(configpath)
        return config
    } catch(e) {
        if (e.code == 'MODULE_NOT_FOUND') {
            try {
                fs.accessSync(path.dirname(configpath))
            } catch (err) {
                fs.mkdirSync(path.dirname(configpath))
            }
            fs.copyFileSync(path.join(__dirname,'config.js.sample'),configpath)
            console.log(`No config found.
    A sample config has been placed at ${configpath}.
    Please edit it to your settings and re-run ${name}`)
        }
        process.exit()
    }
})()
const https = require('https');
const readline = require('readline');
const { Readable } = require('stream');
const dns = require('node:dns/promises');

const getList = require('./getlist');
const getListCSV = require('./getlistcsv');
const { isArray } = require('node:util');
const ua = `rapidblocker/${version}`
const oneWeek = (new Date).setDate((new Date).getDate()+7)
var mod = false
var add = false
var addF = false
var del = false
var verbose = true
var birdsites = false
var bsadd = false
var help = false
var manualadd = []
var checkdomain =[]
var fediblock = false
var peers = null
var cache = null
var blocklists
var spinner;
if ((!config.api_token || config.api_token.length < 10) || (!config.instance || config.instance.toString().length < 10)) {
    console.log("You need to set your instance url and api_key.")
    help = true
}
let domainlist = false
for (const arg of process.argv){
    if (arg[0]=='+') {
        for(const domain of arg.substring(1).split(/,/)){
            manualadd.push(domain)
        }
    }
    if (arg=='-c') {
        verbose = true
        domainlist = true
    } else if (arg[0]=='-') {
        domainlist = false
    } else if (domainlist) {
        checkdomain.push(arg)
    }
    if (arg[0]!='-') continue
    Array.from(arg).forEach(a=>{
        if (a.match('s')) verbose = false
        if (a.match('b')) birdsites = true
        if (a.match('B')) bsadd = birdsites = true
        if (a.match('m')) mod = true
        if (a.match('a')) add = true
        if (a.match('A')) addF = true
        if (a.match('d')) del = true
        if (a.match('F')) fediblock = true
        if (a.match('y')) {
            mod = add = del = true
        }
        if (a.match('h')) help = true
    })
}
if (help) {
    console.log(`usage ${process.argv[0]} [options]
${ua}
    -s      silent                   ${!verbose}
    -b      block birdsites          ${birdsites}
    -B      auto block birdsites     ${bsadd}
    -y      auto add/modify/delete   ${mod==add==del==true}
    -m      auto modify              ${mod}
    -a      auto add no impact       ${add}
    -A      auto add                 ${addF}
    -d      auto delete              ${del}
    -F      output export files      ${fediblock}
            ua_fediblock.conf    - nginx map to block by User-Agent
            fediblockexport.json - fediblock-style export file
            owncastexport.json   - Owncast style export file
            
    +domain[,domains]
            add domains              ${manualadd}
    -c domain[,domains]
            check domain,            ${checkdomain}
            also checks DNS for all exiting blocks
            for failed domains
`)
    process.exit()
}

const askQuestion = (query) => {
        if (spinner?.isEnabled) spinner.stopAndPersist()
        const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });
        return new Promise(resolve => rl.question(query, ans => {
                    rl.close();
                    consoleLog('')
                    resolve(ans);
                }))
}

const consoleLog = async (...args) => {
    if (!verbose) console.log(args)
    msg = args.map(a=>(typeof a=="string")?a:JSON.stringify(a)).join(" ")
    if (!spinner?.isEnabled) {
        ora = (await import('ora')).default;
        spinner = ora(msg);
        spinner.spinner = "aesthetic";
        spinner.start(); 
    } else {
        if (spinner.isSpinning) spinner.stopAndPersist();
        spinner = ora(msg);
        spinner.spinner = "aesthetic";
        spinner.start(); 
    }
}

const findReason = (domain,src) => {
    let reason = ''
    for (const reasonsrc of blocklists) {
        if (src && reasonsrc != src) continue
        let c = 0
        if (reasonsrc.csv) {
            if (Object.keys(reasonsrc.list[0]).length == 1) continue
            for (const i in reasonsrc.list[0]) {
                if (reasonsrc.list[0][i].match(/public_comment$/)) c=i
            }
        }
        match = reasonsrc.list.find(s=>s.domain==domain||s[0]==domain)
        reason = match?.comment || match?.[c]
        reason = reason?.replace(/(no description|unified blocklist sync| \(.*?\))/gi,'')
        if (reason) return reason
    }
}
const getConsensus = (domain) => {
    let consensus = 0
    let suspend = 0
    let silence = 0
    for (const src of blocklists) {
        const match = src.list.find(s=>s.domain==domain||s[0]==domain)
        if (match && src.nuke) return ({ consensus: 100, suspend: 100, silence: 99, nuke: true })
        const severity = match?.severity || match?.[1]
        if (match) consensus++
        if (severity == "suspend") suspend++
        else if (severity == "silence") silence++
    }
    const total = blocklists.filter(b=>!b.nuke).length
    return ( { consensus: consensus/total*100, suspend: suspend/total*100, silence: silence/total*100 } )
}
const getTimeDelta = (timestamp) => {
    const now = new Date().getTime()
    let faildelta = (now-timestamp)/1000
    let failtime = "second"
    if (faildelta > 604800) {
        failtime = "week"
        faildelta = faildelta / 604800
    } else if (faildelta > 86400) {
        failtime = "day"
        faildelta = faildelta / 86400
    } else if (faildelta > 3600) {
        failtime = "hour"
        faildelta = faildelta / 3600
    } else if (faildelta > 60) {
        failtime = "minute"
        faildelta = faildelta / 60
    }
    faildelta = parseInt(faildelta)
    if (faildelta > 1) failtime += "s"
    return `${faildelta} ${failtime}`
}
const checkDomain = (domain) => {
    if (spinner) spinner.txt = `Checking that ${domain} exists...`
    return new Promise((resolve,reject)=>{
        if (new Date().getTime()-cache.failed?.[domain]?.checked < 3600000 ) {
            if (spinner) spinner.text = `${domain} may not exist, it has been failing for ${getTimeDelta(cache.failed[domain].failed)}`
            resolve(false)
        } else
        dns.resolveSoa(domain).then(()=>{
            if (cache.failed[domain]) {
                delete cache.failed[domain]
                fs.writeFileSync(cachepath,JSON.stringify(cache))
            }
            resolve(true)
        }).catch((e)=>{
            if (e.code == 'ENOTFOUND') {
                if (!cache.failed?.[domain]) {
                    if (spinner) spinner.text = `${domain} may not exist anymore`
                    if (cache.failed === undefined) cache.failed = {}
                    cache.failed[domain] = { 
                        failed: new Date().getTime(),
                        checked: new Date().getTime()
                    }
                    fs.writeFileSync(cachepath,JSON.stringify(cache))
                } else {
                    cache.failed[domain].checked = new Date().getTime()
                    fs.writeFileSync(cachepath,JSON.stringify(cache))
                    if (spinner) spinner.text = `${domain} may not exist, it has been failing for ${getTimeDelta(cache.failed[domain].failed)}`
                }
                resolve(false)
            }
            resolve(true)
        })
    })
}

const getBlocks = (min=0,limit=200) => {
    const url = new URL("api/v1/admin/domain_blocks",config.instance)
    return new Promise((resolve,reject)=>{
        url.searchParams.append('limit',limit.toString())
        url.searchParams.append('min_id',min.toString())
        let opt = {
            headers: {
                'authorization': `Bearer ${config.api_token}`,
                'user-agent': ua
            }
        }
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
const setBlock = (domain,severity,reason,notes,id=null) => {
    const url = (id)? new URL(`api/v1/admin/domain_blocks/${id}`,config.instance) : new URL("api/v1/admin/domain_blocks",config.instance)
    return new Promise((resolve,reject)=>{
        let opt = {
            method: (id)? "PUT":"POST",
            headers: {
                'authorization': `Bearer ${config.api_token}`,
                'content-type': 'application/json',
                'user-agent': ua
            }
        }
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
                    reject(error.message)
                };
            });

        }).on("error", (error) => {
            console.error(error.message);
            reject()
        })
        req.write(JSON.stringify(
            {
                'domain': domain,
                'public_comment': reason,
                'private_comment': notes,
                'severity': severity
            }
        ));
        req.end()
    })
}
const deleteBlock = (id) => {
    const url = new URL(`api/v1/admin/domain_blocks/${id}`,config.instance)
    return new Promise((resolve,reject)=>{
        let opt = {
            method: "DELETE",
            headers: {
                'authorization': `Bearer ${config.api_token}`,
                'content-type': 'application/json'
            }
        }
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
                    console.error(error.message);
                    reject(error.message)
                };
            });

        }).on("error", (error) => {
            console.error(error.message);
            reject()
        })
        req.end()
    })
}
const getBlockImpact = (domain) => {
    const url = new URL("api/v1/admin/measures",config.instance)
    return new Promise((resolve,reject)=>{
        let opt = {
            method: 'POST',
            headers: {
                'authorization': `Bearer ${config.api_token}`,
                'content-type': 'application/json',
                'user-agent': ua
            }
        }
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
                    console.error(error.message);
                    reject(error.message)
                };
            });

        }).on("error", (error) => {
            console.error(error.message);
            reject()
        })
        const today = (()=>{
            var d = new Date(),
                month = '' + (d.getMonth() + 1),
                day = '' + d.getDate(),
                year = d.getFullYear();
            if (month.length < 2) 
                month = '0' + month;
            if (day.length < 2) 
                day = '0' + day;
            return [year, month, day].join('-');
        })()
        req.write(JSON.stringify({
            "keys": ["instance_follows","instance_followers"],
            "start_at": today,
            "end_at": today,
            "instance_follows":{"domain":`${domain}`},
            "instance_followers":{"domain":`${domain}`}
        }))
        req.end();
    })
}
const getSubdomains = (domain) => {
    return new Promise((resolve,reject)=>{
        const url = new URL("api/v1/instance/peers",config.instance)
        if (!peers) {
            let opt = {
                method: 'GET',
                headers: {
                    'authorization': `Bearer ${config.api_token}`,
                    'content-type': 'application/json',
                }

            }
            let req = https.request(url,opt,(res) => {
                let body = "";

                res.on("data", (chunk) => {
                    body += chunk;
                });

                res.on("end", () => {
                    try {
                        peers = JSON.parse(body);
                        // do something with JSON
                        resolve(peers.filter(d=>d.endsWith(`.${domain}`)))
                    } catch (error) {
                        console.error(error.message);
                        reject(error.message)
                    };
                });
            }).on("error", (error) => {
                console.error(error.message);
                reject()
            })
            req.end();
        } else {
            resolve(peers.filter(d=>d.endsWith(`.${domain}`)))
        }
    })
}

const joinMastodonServers = () => {
    if (spinner) spinner.text = "Retrieving listed servers from joinmastodon.org..."
    const url = new URL("https://api.joinmastodon.org/servers")
    return new Promise((resolve,reject)=>{
        const opt = {
            headers: {
                'user-agent': ua
            }
        }
        let req = https.request(url,opt,(res) => {
            let data = "";

            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", async () => {
                try {
                    let json = JSON.parse(data.toString());
                    // do something with JSON
                    resolve(json)
                } catch (error) {
                    console.error(error.message);
                    esolve([{}])
                    reject(error.message)
                };
            });

        }).on("error", (error) => {
            console.error(error.message);
            reject(json)
        }).end();
    })
}

const birdSiteServers = () => {
    if (spinner) spinner.text = "Retrieving birdsitelive servers from fediverse.observer..."
    const url = new URL("https://api.fediverse.observer")
    return new Promise((resolve,reject)=>{
        let opt = {
            method: "POST",
            headers: {
                'content-type': 'application/json',
                'user-agent': ua
            }
        }
        let req = https.request(url,opt,(res) => {
            let data = "";

            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", async () => {
                try {
                    let json = JSON.parse(data.toString());
                    // do something with JSON
                    resolve(json)
                } catch (error) {
                    console.error(error.message);
                    reject(error.message)
                };
            });

        }).on("error", (error) => {
            console.error(error.message);
            reject(json)
        })
        req.write(JSON.stringify(
            {"query":"{nodes(softwarename: \"birdsitelive\") {\n  domain\n  name\n  }\n}\n    "}
        ))
        req.end();
    })
}

const getAllBlocks = async ()=>{
    if (spinner) spinner.text = "Retrieving existing blocks..."
    let blocks = await getBlocks();
    let offset = 0;
    while(blocks.length >= offset) {
        offset = Math.max(...blocks.map(l=>parseInt(l.id)))
        let moreBlocks = await getBlocks(offset)
        for (let b of moreBlocks) {
            if (!blocks.find(bl=>bl.id==b.id)) {
                blocks.push(b)
            }
        }
    }
    return blocks
}

const getRobots = (url) => {
    if (spinner) spinner.text = `Getting robots.txt ${url}...`
    return new Promise((resolve,reject)=>{
        let opt = {
            headers: {
                'user-agent': ua
            }
        }
        let req = https.request(url,opt,(res) => {
            let data = "";
            if (res.statusCode < 200 || res.statusCode >= 300) {
                reject(res.statusCode)
            }
            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", async () => {
                try {
                    // do something with JSON
                    resolve(data)
                } catch (error) {
                    console.error(error.message);
                    reject(error.message)
                };
            });

        }).on("error", (error) => {
            console.error(error.message);
            reject(json)
        })
        req.end();
    })
}

const checkRobots = async (fullurl,paths=[]) => {
    const url = new URL(fullurl)
    paths.push(url.pathname)
    try{
        const robots = await getRobots(new URL("/robots.txt",url))
        const rl = readline.createInterface({
            input: Readable.from([robots]),
            crlfDelay: Infinity
        })
        let uaselected = false
        for await (let line of rl) {
            if (line.match(/^(#|\s)/)||line.length<1) continue
            line = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            line = line.replace(/\\\*/g,".*")
            if (`User-agent: ${ua}`.match(new RegExp(line))){
                uaselected = true
            } else if (line.match(/^User-agent: /)) {
                uaselected = false
            }
            if (!uaselected) continue
            if (line.startsWith("Disallow: ")) {
                for (const path of paths) {
                    const disallow = line.replace(/^Disallow: +/,'^')
                    if (path.match(new RegExp(disallow))) {
                        console.error(`${url} not permitted due to robots.txt`)
                        return false
                    }
                }
            }
        }
        rl.close()
    } catch (e) {
    }
    return true
}
consoleLog(`Retrieving existing blocks...`)
if (fediblock)
getAllBlocks().then(async blocks=>{
    const fediblock = blocks.map(b=>{
        return {
        instance: b.domain,
        notes: `${b.private_comment}:${b.public_comment}`
        }
    })
        let uamap = 'map $http_user_agent $ua_fediblock {'
        uamap += '\n\tdefault\t0;';
        for(const block of blocks) {
            if (block.severity != 'suspend') continue;
            uamap += `\n\t"~*https?://([a-z0-9]*\\.)*${block.domain}[ /]"\t1;`
        }
        uamap += '\n}'
    const owncastblock = { value: blocks.map(b=>b.domain) }
    fs.writeFileSync("ua_fediblock.conf",uamap)
    fs.writeFileSync("fediblockexport.json",JSON.stringify(fediblock))
    fs.writeFileSync("owncastexport.json",JSON.stringify(owncastblock))
})
else
getAllBlocks().then(async blocks=>{
    const jmList = (await checkRobots("https://api.joinmastodon.org/servers"))? await joinMastodonServers() : [];
    cache = fs.existsSync(cachepath)? JSON.parse(fs.readFileSync(cachepath,{encoding: "utf8"})) : {}
    blocklists = cache?.blocklists || []
    if (spinner) spinner.text = `Loading ${config.sources.length} blocklists...`
    for ( const src of config.sources ) {
        const idx = blocklists?.findIndex(b=>b.name==src.name)
        let blockEntry = (idx >= 0)? blocklists[idx] : { name: src.name, nuke: src.nuke }
        if (spinner) spinner.text = `loading ${src.name}...`
        if (new Date().getTime()-blockEntry?.last_update<3600000) {
            if (spinner) spinner.text = `Loading ${src.name}...cached.`
            continue
        }
        if (src.csv) {
            blockEntry.csv = true
            blockEntry.list = await getListCSV(src.src)
        } else {
            blockEntry.list = await getList(src.src, src.key)
        }
        blockEntry.last_update = new Date().getTime()
        if (idx >= 0) {
            blocklists[idx] = blockEntry
        } else {
            blocklists.push(blockEntry)
        }
    }
    cache.blocklists = blocklists
    fs.writeFileSync(cachepath,JSON.stringify(cache))
    let blocklisted = []
    let ignorelist = cache.ignored || []
    for (const blocklist of blocklists) {
        for (const blocked of blocklist.list) {
            if ((blocked.domain||blocked[0]).match(/(example\.com|domain)$/i)) continue
            if (config.allowlist.find(a=>a==blocked.domain||a==blocked[0])) continue
            const blockedDomain = (blocklist.csv)? blocked[0] : blocked.domain
            if (!blocklisted.includes(blockedDomain)) blocklisted.push(blockedDomain)
        }
    }
    if (spinner) spinner.text = `Loaded ${blocklisted.length} blocked domains...`
    blocklisted = blocklisted.filter(b=>getConsensus(b).consensus>=config.threshold)
    if (spinner) spinner.text += ` ${blocklisted.length} are > ${config.threshold}% consensus`

    if (checkdomain.length > 0) {
        if (spinner) spinner.text = "Checking blocks for dead domains"
        for (const block of blocks) {
            await checkDomain(block.domain)
        }
        for (const domain of checkdomain) {
            await checkDomain(domain)
            const isSub = blocks.find(b=>b.domain==domain||domain.endsWith(`.${b.domain}`))
            if (isSub?.severity) {
                if (verbose) {
                    consoleLog(domain,': already blocked under',isSub.domain,':',isSub.severity,isSub.public_comment)
                }
            } else {
                if (verbose) {
                    consoleLog(domain,': has no existing block')
                }
            }
            for (const blocklist of blocklists) {
                const entry = (blocklist.csv)? blocklist.list.find(b=>b[0]==domain) : blocklist.list.find(b=>b.domain==domain)
                if (entry) {
                    consoleLog(`*** ${domain} found on ${blocklist.name}`)
                    let reason = findReason(domain,blocklist)
                    if (reason) consoleLog(`-> ${reason}`)
                }
            }
            consoleLog(getConsensus(domain))

            const impact = await getBlockImpact(domain)
            consoleLog(` ${impact.find(s=>s.key=="instance_followers").total} followers & ${impact.find(s=>s.key=="instance_follows").total} follows`)
            let autoadd = addF || (add && impact.find(s=>s.key=="instance_followers").total==0&&impact.find(s=>s.key=="instance_follows").total==0)
            for (const subd of await getSubdomains(domain)) {
                const imp = await getBlockImpact(subd)
                consoleLog(` ${subd}: ${imp.find(s=>s.key=="instance_followers").total} followers & ${imp.find(s=>s.key=="instance_follows").total} follows`)
                if (imp.find(s=>s.key=="instance_followers").total > 0 || imp.find(s=>s.key=="instance_follows").total > 0) autoadd = false
            }
            if (jmList.find(s=>s.domain == domain)) {
                consoleLog("*** This is a listed server. ***")
            }
        }
        if (spinner) spinner.stopAndPersist('')
        process.exit()
    }

    if (verbose) consoleLog("Checking existing blocks for allowlisted servers...")
    for (const block of blocks) {
        const domain = block.domain
        //checkDomain(domain)
        if (config.allowlist.find(w=>w == domain)) {
            if (ignorelist.find(i=>i.domain == domain && i.expires > Date.now())) continue;
            consoleLog("***",domain,"is an allowlisted server, but is set to",block.severity)
            consoleLog(block.public_comment)
            consoleLog(block.private_comment)
            await checkDomain(domain)
            const ans = (del)? 'y':await askQuestion("Do you want to delete this entry (y/i/N)? ");
            if (ans.toLowerCase() == 'y') {
                if (spinner) spinner.text = `Deleting block for ${domain}`
                await (new Promise(resolve => setTimeout(resolve, 1000)))
                const r = await deleteBlock(block.id)
                if (r.error) {
                    spinner.fail(`${r.error}`)
                } else if (spinner) {
                    spinner.succeed(`Deleted block for ${domain}`)
                }
            }
        }
    }
    if (birdsites && checkRobots("https://api.fediverse.observer")) {
        const bbList = await birdSiteServers();
        for (const bb of bbList.data.nodes) {
            const domain = bb.domain
            const block = blocks.find(block=>block.domain==domain)
            if (config.allowlist.find(w=>w==domain)) continue
            if (!block) {
                const isSub = blocks.find(b=>domain.endsWith(`.${b.domain}`))
                if (isSub?.severity) {
                    if (verbose) {
                        consoleLog(':',domain,`(birdsitelive)`,': already blocked under',isSub.domain,':',isSub.severity,isSub.public_comment)
                    }
                    continue
                }
                consoleLog('+',domain,':',"birdsitelive")
                if (jmList.find(s=>s.domain == domain)) {
                    consoleLog("*** This is a listed server. ***")
                }
                const ans = (add||bsadd)? 'y':await askQuestion("Do you want to add this entry (y/N)? ");
                if (ans.toLowerCase() == 'y') {
                    if (spinner) spinner.text = `Adding block for ${domain}`
                    await (new Promise(resolve => setTimeout(resolve, 1000)))
                    const r = await setBlock(domain,"suspend","Third-party bots","birdsitelive")
                    if (r.error) {
                        consoleLog('!',domain,':',r.error,r.existing_domain_block?.domain,r.existing_domain_block?.severity)
                    } else if (spinner) {
                        spinner.succeed(`Blocked ${domain}`)
                    }
                }
            } else if (block.private_comment != "birdsitelive") {
                const ans = (add||bsadd)? 'y':await askQuestion("Do you want to add this entry (y/N)? ");
                if (ans.toLowerCase() == 'y') {
                    if (spinner) spinner.text = `Updating block for ${domain}`
                    await (new Promise(resolve => setTimeout(resolve, 1000)))
                    const r = await setBlock(domain,"suspend","Third-party bots","birdsitelive",block.id)
                    if (r.error) {
                        consoleLog('!',domain,':',r.error,r.existing_domain_block?.domain,r.existing_domain_block?.severity)
                        spinner.fail(`${r.error}`)
                    } else if (spinner) {
                        spinner.succeed(`Updated block for ${domain}`)
                    }
                }
            }
        }
    }
    
    if (spinner) spinner.text = "Checking existing blocks for listed servers..."
    for (const block of blocks) {
        const domain = block.domain
        if (ignorelist.find(i=>i.domain == domain && i.expires > Date.now())) continue;
        if (jmList.find(s=>s.domain == domain)) {
            consoleLog("***",domain,"is a listed server, but is set to",block.severity)
            consoleLog('* ',block.public_comment)
            consoleLog('* ',block.private_comment)
            await checkDomain(domain)
            const ans = (del)? 'y':await askQuestion("Do you want to delete this entry (y/i/N)? ");
            if (ans.toLowerCase() == 'y') {
                if (spinner) spinner.text = `Deleting block for ${domain}`
                await (new Promise(resolve => setTimeout(resolve, 1000)))
                const r = await deleteBlock(block.id)
                if (r.error) {
                    spinner.fail(`${r.error}`)
                } else if (spinner) {
                    spinner.succeed(`Deleted block for ${domain}`)
                }
            }
            if (ans.toLowerCase() == 'i') {
                const idx = ignorelist.findIndex(i=>i.domain==domain);
                const ignore = { domain: domain, expires: oneWeek }
                idx != -1? ignorelist[idx] = ignore : ignorelist.push(ignore)
                if (spinner) spinner.succeed(`Ignoring ${domain} till ${new Date(oneWeek)}`)
                cache.ignored = ignorelist
                fs.writeFileSync(cachepath,JSON.stringify(cache))
            }
        }
    }
    if (spinner) spinner.text = "Checking for changes to Shared blocks..."
    for (const block of blocks) {
        const domain = block.domain
        if (block.private_comment?.startsWith("birdsitelive")) continue;
        if (ignorelist.find(i=>i.domain == domain && i.expires > Date.now())) continue;
        if (block.private_comment != "Shared Blocklist") {
            let reason = findReason(domain) || block.public_comment
            const consensus = getConsensus(domain)
            let severity = (consensus.silence >= consensus.suspend)? "silence" : "suspend"
            if (consensus.consensus >= config.threshold) continue
            let note = block.private_comment
            if(consensus.consensus > 0 && consensus.consensus < config.threshold) {
                if (config.threshold*.2 < consensus.consensus && severity == block.severity) continue
                consoleLog(`*** ${domain} is now ${consensus.consensus.toFixed(2)}% (${severity} ${consensus[severity].toFixed(2)}), but is set to ${block.severity}`)
                note = "Shared Blocklist"
            } else {
                consoleLog("***",domain,"is not found in any blocklists, but is set to",block.severity)
                consoleLog('* ',block.public_comment)
                consoleLog('* ',block.private_comment)
                await checkDomain(domain)
                const ans = (del)? 'y':await askQuestion("Do you want to delete this entry (y/i/N)? ");
                if (ans.toLowerCase() == 'y') {
                    if (spinner) spinner.text = `Deleting block for ${domain}`
                    await (new Promise(resolve => setTimeout(resolve, 1000)))
                    const r = await deleteBlock(block.id)
                    if (r.error) {
                        spinner.fail(r.error)
                    } else if (spinner) {
                        spinner.succeed(`Deleted block for ${domain}`)
                    }
                }
                if (ans.toLowerCase() == 'i') {
                    const idx = ignorelist.findIndex(i=>i.domain==domain);
                    const ignore = { domain: domain, expires: oneWeek }
                    idx != -1? ignorelist[idx] = ignore : ignorelist.push(ignore)
                    if (spinner) spinner.succeed(`Ignoring ${domain} till ${new Date(oneWeek)}`)
                    cache.ignored = ignorelist
                    fs.writeFileSync(cachepath,JSON.stringify(cache))
                }
                continue
            }
            consoleLog('* ',block.severity,'->',severity)
            consoleLog('* ',block.public_comment,'->',reason)
            consoleLog('* ',block.private_comment,'->',note)
            if (severity == 'suspend' && block.severity != 'suspend') {
                const impact = await getBlockImpact(domain)
                consoleLog(` ${impact.find(s=>s.key=="instance_followers").total} followers & ${impact.find(s=>s.key=="instance_follows").total} follows`)
                for (const subd of await getSubdomains(domain)) {
                    const imp = await getBlockImpact(subd)
                    consoleLog(` ${subd}: ${imp.find(s=>s.key=="instance_followers").total} followers & ${imp.find(s=>s.key=="instance_follows").total} follows`)
                }
            }
            let ans = (mod)? 'y':await askQuestion("Do you want to modify this entry (y/r/i/N)? ");
            if (ans.toLowerCase() == 'r') {
                let reasons = []
                for (const reasonsrc of blocklists) {
                    const onereason = findReason(domain,reasonsrc)
                    if (onereason) reasons.push({ src: reasonsrc.name, reason: onereason })
                }
                for (const idx in reasons) {
                    consoleLog(`${idx}: ${reasons[idx].src} -> ${reasons[idx].reason}`)
                }
                ans = await askQuestion("Which reason (press enter for manual entry)? ");
                if (ans == '' || !reasons[ans]) {
                    reason = await askQuestion("Enter reason: ");
                } else {
                    reason = reasons[ans].reason
                }
                consoleLog('* ',block.severity,'->',severity)
                consoleLog('* ',block.public_comment,'->',reason)
                consoleLog('* ',block.private_comment,'->',note)
                ans = await askQuestion("Do you want to modify this entry (y/i/N)? ");
            }
            if (ans.toLowerCase() == 'y') {
                if (spinner) spinner.text = `Updating block for ${domain}`
                await (new Promise(resolve => setTimeout(resolve, 1000)))
                const r = await setBlock(domain,severity,reason,note,block.id)
                if (r.error) {
                    spinner.fail(r.error)
                } else if (spinner) {
                    spinner.succeed(`Updated block for ${domain}`)
                }
            }
            if (ans.toLowerCase() == 'i') {
                const idx = ignorelist.findIndex(i=>i.domain==domain);
                const ignore = { domain: domain, expires: oneWeek }
                idx != -1? ignorelist[idx] = ignore : ignorelist.push(ignore)
                if (spinner) spinner.succeed(`Ignoring ${domain} till ${new Date(oneWeek)}`)
                cache.ignored = ignorelist
                fs.writeFileSync(cachepath,JSON.stringify(cache))
            }

        } else if (block.private_comment != "Shared Blocklist") {
            if (blocklisted.find(d=>d==block.domain)) {
                const note = "Shared Blocklist"
                let reason = findReason(domain) || block.public_comment
                consoleLog("*** Update",block.domain,"to",note)
                consoleLog(`* ${block.public_comment} -> ${reason}`)
                consoleLog(`* ${block.private_comment} -> ${note}`)
                let ans = (mod)? 'y':await askQuestion("Do you want to update this entry (y/r/i/N)? ");
                if (ans.toLowerCase() == 'r') {
                    let reasons = []
                    for (const reasonsrc of blocklists) {
                        const onereason = findReason(domain,reasonsrc)
                        if (onereason) reasons.push({ src: reasonsrc.name, reason: onereason })
                    }
                    for (const idx in reasons) {
                        consoleLog(`${idx}: ${reasons[idx].src} -> ${reasons[idx].reason}`)
                    }
                    ans = await askQuestion("Which reason (press enter for manual entry)? ");
                    if (ans == '' || !reasons[ans]) {
                        reason = await askQuestion("Enter reason: ");
                    } else {
                        reason = reasons[ans].reason
                    }
                    consoleLog('* ',block.severity,'->',severity)
                    consoleLog('* ',block.public_comment,'->',reason)
                    consoleLog('* ',block.private_comment,'->',note)
                    ans = await askQuestion("Do you want to update this entry (y/i/N)? ");
                }
                if (ans.toLowerCase() == 'y') {
                    if (spinner) spinner.text = `Updating block for ${domain}`
                    await (new Promise(resolve => setTimeout(resolve, 1000)))
                    const r = await setBlock(block.domain,block.severity,reason,note,block.id)
                    if (r.error) {
                        spinner.fail(r.error)
                    } else if (spinner) {
                        spinner.succeed(`Updated block for ${domain}`)
                    }
                }
                if (ans.toLowerCase() == 'i') {
                    const idx = ignorelist.findIndex(i=>i.domain==domain);
                    const ignore = { domain: domain, expires: oneWeek }
                    idx != -1? ignorelist[idx] = ignore : ignorelist.push(ignore)
                    if (spinner) spinner.succeed(`Ignoring ${domain} till ${new Date(oneWeek)}`)
                    cache.ignored = ignorelist
                    fs.writeFileSync(cachepath,JSON.stringify(cache))
                }
            }
        } else if (block.public_comment == '') {
            let reason = findReason(domain) || block.public_comment
            if (reason) {
                consoleLog("*** Update reason for",domain,"to",reason)
                let ans = (mod)? 'y':await askQuestion("Do you want to update this entry (y/r/i/N)? ");
                if (ans.toLowerCase() == 'r') {
                    let reasons = []
                    for (const reasonsrc of blocklists) {
                        const onereason = findReason(domain,reasonsrc)
                        if (onereason) reasons.push({ src: reasonsrc.name, reason: onereason })
                    }
                    for (const idx in reasons) {
                        consoleLog(`${idx}: ${reasons[idx].src} -> ${reasons[idx].reason}`)
                    }
                    ans = await askQuestion("Which reason (press enter for manual entry)? ");
                    if (ans == '' || !reasons[ans]) {
                        reason = await askQuestion("Enter reason: ");
                    } else {
                        reason = reasons[ans].reason
                    }
                    consoleLog('* ',block.public_comment,'->',reason)
                    ans = await askQuestion("Do you want to update this entry (y/i/N)? ");
                }
                if (ans.toLowerCase() == 'y') {
                    if (spinner) spinner.text = `Updating block for ${domain}`
                    await (new Promise(resolve => setTimeout(resolve, 1000)))
                    const r = await setBlock(domain,block.severity,reason,block.private_comment,block.id)
                    if (r.error) {
                        spinner.fail(r.error)
                    } else if (spinner) {
                        spinner.succeed(`Updated block for ${domain}`)
                    }
                }
                if (ans.toLowerCase() == 'i') {
                    const idx = ignorelist.findIndex(i=>i.domain==domain);
                    const ignore = { domain: domain, expires: oneWeek }
                    idx != -1? ignorelist[idx] = ignore : ignorelist.push(ignore)
                    if (spinner) spinner.succeed(`Ignoring ${domain} till ${new Date(oneWeek)}`)
                    cache.ignored = ignorelist
                    fs.writeFileSync(cachepath,JSON.stringify(cache))
                }
            }
        }
    }
    if (manualadd) {
        for (const domain of manualadd) {
            const isSub = blocks.find(b=>b.domain==domain||domain.endsWith(`.${b.domain}`))
            if (isSub?.severity) {
                if (verbose) {
                    consoleLog(domain,': already blocked under',isSub.domain,':',isSub.severity,isSub.public_comment)
                }
                continue
            }
            const consensus = getConsensus(domain)
            if (consensus.consensus > 0) {
                consoleLog(`*** This server is blocked with ${consensus.consensus.toFixed(2)}%. ***`)
            }

            consoleLog('+',domain,':')
            const impact = await getBlockImpact(domain)
            consoleLog(` ${impact.find(s=>s.key=="instance_followers").total} followers & ${impact.find(s=>s.key=="instance_follows").total} follows`)
            let autoadd = addF || (add && impact.find(s=>s.key=="instance_followers").total==0&&impact.find(s=>s.key=="instance_follows").total==0)
            for (const subd of await getSubdomains(domain)) {
                const imp = await getBlockImpact(subd)
                consoleLog(` ${subd}: ${imp.find(s=>s.key=="instance_followers").total} followers & ${imp.find(s=>s.key=="instance_follows").total} follows`)
                if (imp.find(s=>s.key=="instance_followers").total > 0 || imp.find(s=>s.key=="instance_follows").total > 0) autoadd = false
            }
            if (jmList.find(s=>s.domain == domain)) {
                consoleLog("*** This is a listed server. ***")
            }
            const ans = (add)? 'y':await askQuestion("Do you want to add this entry (y/N)? ");
            if (ans.toLowerCase() == 'y') {
                if (spinner) spinner.text = `Adding block for ${domain}`
                const reason = await askQuestion("Public comment/reason: ");
                const priv = await askQuestion("Private comment: ");
                await (new Promise(resolve => setTimeout(resolve, 1000)))
                const r = await setBlock(domain,"suspend",reason,priv)
                if (r.error) {
                    consoleLog('!',domain,':',r.error,r.existing_domain_block?.domain,r.existing_domain_block?.severity)
                    spinner.fail(r.error)
                } else if (spinner) {
                    spinner.succeed(`Added block for ${domain}`)
                }
            }
        }
    }
    for (const domain of blocklisted) {
        if (config.allowlist.find(w=>w==domain)) continue
        if (ignorelist.find(i=>i.domain == domain && i.expires > Date.now())) continue;
        const isSub = blocks.find(b=>domain.endsWith(`.${b.domain}`))
        if (isSub?.severity) {
            if (verbose) {
                consoleLog(':',domain,': already blocked under',isSub.domain,':',isSub.severity,isSub.public_comment)
            }
            continue
        }
        if (!blocks.find(b=>b.domain==domain)) {
            let reason = findReason(domain) || ''
            const consensus = getConsensus(domain)
            const severity = (consensus.silence >= consensus.suspend)? "silence" : "suspend"
            consoleLog(`+ ${domain} ${consensus.consensus.toFixed(2)}% ${severity} : ${reason}`)
            const impact = await getBlockImpact(domain)
            consoleLog(` ${impact.find(s=>s.key=="instance_followers").total} followers & ${impact.find(s=>s.key=="instance_follows").total} follows`)
            let autoadd = addF || (add && impact.find(s=>s.key=="instance_followers").total==0&&impact.find(s=>s.key=="instance_follows").total==0)
            for (const subd of await getSubdomains(domain)) {
                const imp = await getBlockImpact(subd)
                consoleLog(` ${subd}: ${imp.find(s=>s.key=="instance_followers").total} followers & ${imp.find(s=>s.key=="instance_follows").total} follows`)
                if (imp.find(s=>s.key=="instance_followers").total > 0 || imp.find(s=>s.key=="instance_follows").total > 0) autoadd = false
            }
            if (jmList.find(s=>s.domain == domain)) {
                consoleLog("*** This is a listed server. ***")
            }
            let ans = (autoadd)? 'y':await askQuestion("Do you want to add this entry (y/r/i/N)? ");
            if (ans.toLowerCase() == 'r') {
                let reasons = []
                for (const reasonsrc of blocklists) {
                    const onereason = findReason(domain,reasonsrc)
                    if (onereason) reasons.push({ src: reasonsrc.name, reason: onereason })
                }
                for (const idx in reasons) {
                    consoleLog(`${idx}: ${reasons[idx].src} -> ${reasons[idx].reason}`)
                }
                ans = await askQuestion("Which reason (press enter for manual entry)? ");
                if (ans == '' || !reasons[ans]) {
                    reason = await askQuestion("Enter reason: ");
                } else {
                    reason = reasons[ans].reason
                }
                consoleLog('* ',block.public_comment,'->',reason)
                ans = await askQuestion("Do you want to add this entry (y/i/N)? ");
            }
            if (ans.toLowerCase() == 'y') {
                if (spinner) spinner.text = `Adding block for ${domain}`
                await (new Promise(resolve => setTimeout(resolve, 1000)))
                const r = await setBlock(domain,severity,reason,"Shared Blocklist")

                if (r.error) {
                    consoleLog('!',domain,':',r.error,r.existing_domain_block?.domain,r.existing_domain_block?.severity)
                    spinner.fail(r.error)
                } else if (spinner) {
                    spinner.succeed(`Added block for ${domain}`)
                }
            }
            if (ans.toLowerCase() == 'i') {
                const idx = ignorelist.findIndex(i=>i.domain==domain);
                const ignore = { domain: domain, expires: oneWeek }
                idx != -1? ignorelist[idx] = ignore : ignorelist.push(ignore)
                if (spinner) spinner.succeed(`Ignoring ${domain} till ${new Date(oneWeek)}`)
                cache.ignored = ignorelist
                fs.writeFileSync(cachepath,JSON.stringify(cache))
            }
        }
    }
    if (spinner) spinner.stopAndPersist()
}).catch(e=>console.error(`Error: ${e}`))
