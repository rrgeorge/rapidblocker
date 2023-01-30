# rapidblocker
script to load rapidblock blocklist and more
I threw this together quickly, I give no guarantees
# instructions
Edit rapidblock.js:
- set instance to your instance url
- set api_key to an api key that has admin:read & admin:write permissions
  - To create such an api key, go to `https://<your-mastodon-server>/settings/applications`,
    click `New application`, fill in something appropriate for the application name,
    scroll to the bottom of the page and select `admin:read` and `admin:write`, then
    click `SUBMIT`.
    Once created, select your entry and use the value listed for `Your access token`.
Do `chmod 755 rapidblock.js`
Do `./rapidblock.js -h`
