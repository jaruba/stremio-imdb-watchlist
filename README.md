# Stremio Add-on to Add an IMDB Watchlist as a Catalog

This is a simple add-on that uses an ajax call to get a list of items from IMDB, then converts those items to Stremio supported Meta Objects.


## Using locally

**Pre-requisites: Node.js, Git**

```
git clone https://github.com/jaruba/stremio-imdb-watchlist.git
cd stremio-imdb-watchlist
npm i
npm start
```

This will print `http://127.0.0.1:7505/[imdb-user-id]/manifest.json`. Add a IMDB list id instead of `[imdb-user-id]` in this URL and load the add-on in Stremio.


## Using remotely

Use `https://stremio-imdb-watchlist.now.sh/[imdb-user-id]/manifest.json`. Add a IMDB list id instead of `[imdb-user-id]` in this URL and load the add-on in Stremio.


## What is a IMDB List ID

Presuming that the user profile page you want to add is `https://www.imdb.com/user/ur1000000/`, the IMDB user id in this case is `ur1000000`.


## How this add-on was made

### 1. Create a `package.json` and add dependencies

```json
{
  "name": "stremio-imdb-watchlist",
  "version": "0.0.1",
  "description": "Add-on to create a catalog of your IMDB user watchlist.",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "needle": "^2.2.4",
    "cheerio": "1.0.0-rc.2",
    "express": "^4.16.4",
    "cors": "^2.8.5",
    "named-queue": "^2.2.1"
  }
}
```

We will use `needle` to make the html page request, `cheerio` to create a jQuery instance of the HTML content, `express` to create the add-on http server, `cors` to easily add CORS to our http server responses and `named-queue` because although we'll get two catalog requests (one for movies and one for series), we only need to do one ajax request as IMDB lists include both. That's where `named-queue` comes in, as it merges tasks by `id`, so we only do one ajax request to respond to both catalog requests.

### 2. Add-on manifest

In this step, we define the add-on name, description and purpose.

Create an `index.js` file:

```javascript
const manifest = {

  // set add-on id, any string unique between add-ons
  id: 'org.imdbwatchlist',

  // setting a semver add-on version is mandatory
  version: '0.0.1',

  // human readable add-on name
  name: 'IMDB Watchlist Add-on',

  // description of the add-on
  description: 'Add-on to create a catalog of your IMDB user watchlist.',

  // we only need 'catalog' for this add-on, can also be 'meta', 'stream' and 'subtitles'
  resources: ['catalog'],

  // we set the add-on types, can also be 'tv', 'channel' and 'other'
  types: ['movie', 'series'],

  // we define our catalogs, we'll make one for 'movies' and one for 'series'
  catalogs: [
    {
      // id of catalog, any string unique between this add-ons catalogs
      id: 'imdb-movie-watchlist',

      // human readable catalog name
      name: 'IMDB Movie Watchlist',

      // the type of this catalog provides
      type: 'movie'
    }, {
      id: 'imdb-series-watchlist',
      name: 'IMDB Series Watchlist',
      type: 'series'
    }
  ]
}


// create add-on server
const express = require('express')
const app = express()
const cors = require('cors')

// add CORS to server responses
app.use(cors())

// respond to the manifest request
app.get('/:imdbUser/manifest.json', (req, res) => {
    res.send(manifest)
})
```


### 3. Get Watchlist ID from User ID

Now we need to get the watchlist ID based on the user ID the add-on user provides.

```javascript
// we'll use needle to request the HTML page
const needle = require('needle')

// we'll use cheerio to create a jQuery instance from the HTML page
const cheerio = require('cheerio')

// set request headers to have Chrome Android user agent
const headers = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 8.0.0; TA-1053 Build/OPR1.170623.026) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/67.0.3368.0 Mobile Safari/537.36',
}

// object to cache our watchlist ID based on user ID
const cacheLists = {}

// function to get list id from user id
function getListId(userId, cb) {

  // check if it's in cache first
  if (cacheLists[userId]) {
    cb(false, cacheLists[userId])
    return
  }

  // set request referer to the user page of the user id
  headers.referer = 'https://m.imdb.com/user/'+userId+'/'

  // set request url, in this case, the watchlist page of the user
  const getUrl = 'https://m.imdb.com/user/'+userId+'/watchlist/'

  // send request
  needle.get(getUrl, { headers }, (err, resp) => {
    if (!err && resp && resp.body) {

      // load jQuery instance from the HTML page
      const $ = cheerio.load(resp.body)

      const listMeta = $('meta[property="pageId"]')

      // check to see if the needed HTML element exists
      if (!listMeta || listMeta.length != 1) {
        cb('Error parsing page #1')
        return
      }

      // get list id from page
      const listId = listMeta.attr('content')

      // check list id for sanity
      if (!listId || !listId.startsWith('ls')) {
        cb('Error parsing page #2')
        return
      }

      // cache list id
      cacheLists[userId] = listId

      // respond with the list id
      cb(false, listId)

    } else {
      // respond with error
      cb(err || 'Empty html body when requesting list id')
    }
  })
}
```

### 4. Proxy a Different Add-on to get List Responses Based on List ID

We won't handle converting IMDB items to Stremio Meta Objects in this guide, we will proxy a different add-on that does this. The secondary add-on will be `stremio-imdb-list`, the source code for it and a guide on how it was made can [found here](https://github.com/jaruba/stremio-imdb-list).

```javascript

// we use `named-queue` to merge more tasks
// with the same user id
const namedQueue = require('named-queue')

const queue = new namedQueue((task, cb) => {
  // get the list id from user id with the
  // function from the previous step
  getListId(task.id, cb)
}, Infinity)

// where the secondary add-on is hosted
const listEndpoint = 'https://stremio-imdb-list.now.sh/'

function getList(type, userId, cb) {
  queue.push({ id: userId }, (listErr, listId) => {
    if (listId) {
      // list id is correct, let's request the
      // list contents from the secondary add-on
      const getUrl = listEndpoint + listId + '/catalog/' + type + '/imdb-' + type + '-list.json'
      needle.get(getUrl, { headers }, (err, resp) => {
        if (err) {
          // failed, send error
          cb(err)
        } else if (!resp || !resp.body) {
          // failed, send error
          cb('Empty list response from endpoint')
        }
        else {
          // success, return result
          cb(false, resp.body)
        }
      })
    } else {
      // request failed, send error
      cb(listErr || 'Could not get watchlist id')
    }
  })
}
```

### 5. Catalog Handler

We create the catalog handler, get the user id from the user as it's part of the add-on url and merge http requests for the same user id.

```javascript
// users pass the user id in the add-on url
// this will be available as `req.params.imdbUser`
app.get('/:imdbUser/catalog/:type/:id.json', (req, res) => {

  // handle failures
  function fail(err) {
    console.error(err)
    res.writeHead(500)
    res.end(JSON.stringify({ err: 'handler error' }))
  }

  // ensure request parameters are known
  if (req.params.imdbUser && ['movie','series'].indexOf(req.params.type) > -1) {
    // use function from previous step
    // to get list items from user id
    getList(req.params.type, req.params.imdbUser, (err, resp) => {
      if (resp)
        res.send(resp)
      else 
        fail(err)
    })
  } else
    fail('Unknown request parameters')
})

```

### 6. Run the Add-on Server

```javascript
app.listen(7505, () => {
    console.log('http://127.0.0.1:7505/[imdb-user-id]/manifest.json')
})
```

### 7. Install Add-on in Stremio

![addlink](https://user-images.githubusercontent.com/1777923/43146711-65a33ccc-8f6a-11e8-978e-4c69640e63e3.png)
