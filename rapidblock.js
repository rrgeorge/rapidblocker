#!/usr/bin/env -S node --no-warnings

// Your instance url
const instance = new URL("")
// Your api key with admin:read & admin:write perms
const api_key = ""

const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const readline = require('readline');

var mod = false
var add = false
var del = false
var update_limit = false
var verbose = false
var skipListed = false
var birdsites = false
var bsadd = false
var help = false

if ((!api_key || api_key.length < 10) || (!instance || instance.toString().length < 10)) {
    console.log("You need to set your instance url and api_key.")
    help = true
}

for (const arg of process.argv){
    if (arg[0]!='-') continue
    Array.from(arg).forEach(a=>{
        if (a.match('v')) verbose = true
        if (a.match('b')) birdsites = true
        if (a.match('B')) bsadd = birdsites = true
        if (a.match('u')) update_limit = true
        if (a.match('m')) mod = true
        if (a.match('a')) add = true
        if (a.match('d')) del = true
        if (a.match('y')) {
            mod = add = del = true
        }
        if (a.match('h')) help = true
    })
}
if (help) {
    console.log(`usage ${process.argv[0]} [options]
    -v      verbose                 ${verbose}
    -b      block birdsites         ${birdsites}
    -B      auto block birdsites    ${bsadd}
    -y      auto add/modify/delete  ${mod==add==del==true}
    -u      update limit to suspend ${update_limit}
    -m      auto modify             ${mod}
    -a      auto add                ${add}
    -d      auto delete             ${del}
`)
    process.exit()
}

function askQuestion(query) {
        const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });

        return new Promise(resolve => rl.question(query, ans => {
                    rl.close();
                    resolve(ans);
                }))
}

const getBlocks = (min=0,limit=200) => {
    const url = new URL("api/v1/admin/domain_blocks",instance)
    return new Promise((resolve,reject)=>{
        url.searchParams.append('limit',limit.toString())
        url.searchParams.append('min_id',min.toString())
        let opt = {
            headers: {
                'authorization': `Bearer ${api_key}`
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
const setBlock = (domain,reason,notes,id=null) => {
    const url = (id)? new URL(`api/v1/admin/domain_blocks/${id}`,instance) : new URL("api/v1/admin/domain_blocks",instance)
    return new Promise((resolve,reject)=>{
        let opt = {
            method: (id)? "PUT":"POST",
            headers: {
                'authorization': `Bearer ${api_key}`,
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
        req.write(JSON.stringify(
            {
                'domain': domain,
                'public_comment': reason,
                'private_comment': notes,
                'severity': 'suspend'
            }
        ));
        req.end()
    })
}
const deleteBlock = (id) => {
    const url = new URL(`api/v1/admin/domain_blocks/${id}`,instance)
    return new Promise((resolve,reject)=>{
        let opt = {
            method: "DELETE",
            headers: {
                'authorization': `Bearer ${api_key}`,
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

const getRapidBlockSig = () => {
    const url = new URL("https://rapidblock.org/blocklist.json.sig")
    return new Promise((resolve,reject)=>{
        let req = https.request(url,(res) => {
            let body = "";

            res.on("data", (chunk) => {
                body += chunk
            });

            res.on("end", () => {
                try {
                    const sig = Buffer.from(body,'base64')
                    resolve(sig)
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
const getRapidBlockPub = () => {
    const url = new URL("https://rapidblock.org/rapidblock.pub")
    return new Promise((resolve,reject)=>{
        let req = https.request(url,(res) => {
            let body = "";

            res.on("data", (chunk) => {
                body += chunk
            });

            res.on("end", () => {
                try {
                    const sig = Buffer.from(body,'base64')
                    resolve(sig)
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

const getRapidBlocks = () => {
    if (verbose) console.log("Retrieving blocklist from rapidblock.org...")
    const url = new URL("https://rapidblock.org/blocklist.json")
    return new Promise((resolve,reject)=>{
        let req = https.request(url,(res) => {
            let data = "";

            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", async () => {
                try {
                    const body = data.replaceAll('\r','')
                    if (verbose) console.log("Verifying rapidblock signature...")
                    const key = await crypto.webcrypto.subtle.importKey(
                        'raw',
                        await getRapidBlockPub(),
                        {algorithm: 'Ed25519', name: 'Ed25519'},
                        false, ['verify'])
                    const hash = crypto.createHash('sha256').update(body).digest();
                    const ok = await crypto.webcrypto.subtle.verify('Ed25519',key,await getRapidBlockSig(),hash)
                    if (!ok) {
                        reject("bad rapidblock signature")
                    }
                    let json = JSON.parse(body.toString());
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
        }).end();
    })
}
const joinMastodonServers = () => {
    if (verbose) console.log("Retrieving listed servers from joinmastodon.org...")
    const url = new URL("https://api.joinmastodon.org/servers")
    return new Promise((resolve,reject)=>{
        let req = https.request(url,(res) => {
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
        }).end();
    })
}
const birdSiteServers = () => {
    if (verbose) console.log("Retrieving birdsitelive servers from fediverse.observer...")
    const url = new URL("https://api.fediverse.observer")
    return new Promise((resolve,reject)=>{
        let opt = {
            method: "POST",
            headers: {
                'content-type': 'application/json'
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
    if (verbose) console.log("Retrieving existing blocks...")
    let blocks = await getBlocks();
    let offset = 0; 
    while(blocks.length >= offset+200) {
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

getRapidBlocks().then(rapid=>{
    getAllBlocks().then(async blocks=>{
        const jmList = await joinMastodonServers();
        if (birdsites) {
            const bbList = await birdSiteServers();
            for (const bb of bbList.data.nodes) {
                const domain = bb.domain
                const block = blocks.find(block=>block.domain==domain)
                if (!block) {
                    const isSub = blocks.find(b=>domain.endsWith(`.${b.domain}`))
                    if (isSub?.severity) {
                        if (verbose) {
                            console.log(':',domain,`(birdsitelive)`,': already blocked under',isSub.domain,':',isSub.severity,isSub.public_comment)
                        }
                        continue
                    }
                    console.log('+',domain,':',"birdsitelive")
                    if (jmList.find(s=>s.domain == domain)) {
                        console.log("*** This is a listed server. ***")
                    }
                    const ans = (add||bsadd)? 'y':await askQuestion("Do you want to add this entry (y/N)? ");
                    if (ans.toLowerCase() == 'y') {
                        await (new Promise(resolve => setTimeout(resolve, 1000)))
                        const r = await setBlock(domain,"Third-party bots","birdsitelive")
                        if (r.error) {
                            console.log('!',domain,':',r.error,r.existing_domain_block?.domain,r.existing_domain_block?.severity)
                        }
                    }
                }
            }
        }
        const domains = Object.keys(rapid.blocks)
        if (verbose) console.log("Checking existing blocks for listed servers...")
        for (const block of blocks) {
            const domain  = block.domain
            if (jmList.find(s=>s.domain == domain)) {
                console.log("***",domain,"is a listed server, but is set to",block.severity)
                console.log(block.public_comment)
                console.log(block.private_comment)
                const ans = (del)? 'y':await askQuestion("Do you want to delete this entry (y/N)? ");
                if (ans.toLowerCase() == 'y') {
                    await (new Promise(resolve => setTimeout(resolve, 1000)))
                    const r = await deleteBlock(block.id)
                    if (r.error) {
                        console.log(r.error)
                    }
                }
            }
        }
        for (const domain of domains) {
            const block = blocks.find(block=>block.domain==domain)
            if (block) {
                if (block.severity != "suspend" && rapid.blocks[domain].isBlocked) {
                    if (!update_limit&&block.severity=="silence") {
                        if (verbose) {
                            console.log('>',domain,'is already set to',block.severity,'-',block.public_comment)
                            if (block.private_comment) console.log('  Notes: ',block.private_comment)
                        }
                        continue
                    }
                    console.log('>',domain,'is already set to',block.severity,'-',block.public_comment)
                    if (block.private_comment) console.log('  Notes: ',block.private_comment)
                    const ans = (mod)? 'y':await askQuestion("Do you want to update this entry to suspend (y/N)? ");
                    if (ans.toLowerCase() == 'y') {
                        await (new Promise(resolve => setTimeout(resolve, 1000)))
                        const r = await setBlock(domain,rapid.blocks[domain].reason,'rapidblock.org',block.id)
                        if (r.error) {
                            console.log('!',domain,':',r.error,r.existing_domain_block?.domain)
                        } else {
                            console.log('>',domain,':',r.domain,r.severity,r.private_comment,r.public_comment)
                        }
                    }
                } else if (rapid.blocks[domain].isBlocked && !block.public_comment && rapid.blocks[domain].reason) {
                        await (new Promise(resolve => setTimeout(resolve, 1000)))
                        const r = await setBlock(domain,rapid.blocks[domain].reason,'rapidblock.org',block.id)
                        if (r.error) {
                            console.log('!',domain,':',r.error,r.existing_domain_block?.domain)
                        } else {
                            console.log('>',domain,':',r.domain,r.severity,r.private_comment,r.public_comment)
                        }
                } else if (!rapid.blocks[domain].isBlocked) {
                    console.log('-',block.id,domain,'is not longer blocked, but is set to:',block.severity,block.public_comment,block.private_comment)
                    const ans = (del)? 'y':await askQuestion("Do you want to delete this entry (y/N)? ");
                    if (ans.toLowerCase() == 'y') {
                        await (new Promise(resolve => setTimeout(resolve, 1000)))
                        const r = await deleteBlock(block.id)
                        if (r.error) {
                            console.log(r.error)
                        }
                    }
                }
            } else if (rapid.blocks[domain].isBlocked) {
                const isSub = blocks.find(b=>domain.endsWith(`.${b.domain}`))
                if (isSub?.severity) {
                    if (verbose) {
                        console.log(':',domain,`(${rapid.blocks[domain].reason})`,': already blocked under',isSub.domain,':',isSub.severity,isSub.public_comment)
                    }
                    continue
                }

                console.log('+',domain,':',rapid.blocks[domain].reason)
                if (jmList.find(s=>s.domain == domain)) {
                    console.log("*** This is a listed server. ***")
                }
                const ans = (add)? 'y':await askQuestion("Do you want to add this entry (y/N)? ");
                if (ans.toLowerCase() == 'y') {
                    await (new Promise(resolve => setTimeout(resolve, 1000)))
                    const r = await setBlock(domain,rapid.blocks[domain].reason,'rapidblock.org')
                    if (r.error) {
                        console.log('!',domain,':',r.error,r.existing_domain_block?.domain,r.existing_domain_block?.severity)
                    }
                }
            }
        }
    }).catch(e=>console.error(`Error: ${e}`))
}).catch(e=>console.error(`Error: ${e}`))
