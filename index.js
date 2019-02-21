
const express = require('express')
const app = express()
const cors = require('cors')

app.use(cors())

const manifest = {
	id: 'org.imdbwatchlist',
	version: '0.0.1',
	name: 'IMDB Watchlist Add-on',
	description: 'Add-on to create a catalog of a IMDB user watchlist.',
	resources: ['catalog'],
	types: ['movie', 'series'],
	catalogs: [
		{
			id: 'imdb-movie-watchlist',
			name: 'IMDB Movie Watchlist',
			type: 'movie'
		}, {
			id: 'imdb-series-watchlist',
			name: 'IMDB Series Watchlist',
			type: 'series'
		}
	]
}

const listManifest = {}

app.get('/:imdbUser/manifest.json', (req, res) => {
	if (listManifest[req.params.imdbUser]) {
		res.send(listManifest[req.params.imdbUser])
		return
	}
	queue.push({ id: req.params.imdbUser }, (listErr, listId) => {
		if (listId) {
			const getUrl = listEndpoint + listId + '/manifest.json'
			needle.get(getUrl, { headers }, (err, resp) => {
				if (err)
					res.send(manifest)
				else if (!resp || !resp.body || !resp.body.name || resp.body.name == 'IMDB List Add-on')
					res.send(manifest)
				else {
					const cloneManifest = JSON.parse(JSON.stringify(manifest))
					cloneManifest.id = 'org.imdbwatchlist' + req.params.imdbUser
					cloneManifest.name = resp.body.name
					cloneManifest.catalogs.forEach((cat, ij) => {
						cloneManifest.catalogs[ij].name = resp.body.name
					})
					listManifest[req.params.imdbUser] = cloneManifest
					res.send(cloneManifest)
				}
			})
		} else
			res.send(manifest)
	})
})

const needle = require('needle')
const cheerio = require('cheerio')

const headers = {
	'User-Agent': 'Mozilla/5.0 (Linux; Android 8.0.0; TA-1053 Build/OPR1.170623.026) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/67.0.3368.0 Mobile Safari/537.36',
}

const cacheLists = {}

function getListId(userId, cb) {

	if (cacheLists[userId]) {
		cb(false, cacheLists[userId])
		return
	}

	headers.referer = 'https://m.imdb.com/user/'+userId+'/'
	const getUrl = 'https://m.imdb.com/user/'+userId+'/watchlist/'

	needle.get(getUrl, { headers }, (err, resp) => {
		if (!err && resp && resp.body) {

			const $ = cheerio.load(resp.body)
			const listMeta = $('meta[property="pageId"]')

			if (!listMeta || listMeta.length != 1) {
				cb('Error parsing page #1')
				return
			}

			const listId = listMeta.attr('content')

			if (!listId || !listId.startsWith('ls')) {
				cb('Error parsing page #2')
				return
			}

			cacheLists[userId] = listId

			cb(false, listId)

		} else
			cb(err || 'Empty html body when requesting list id')
	})
}

const namedQueue = require('named-queue')

const queue = new namedQueue((task, cb) => {
	getListId(task.id, cb)
}, Infinity)

const listEndpoint = 'https://stremio-imdb-list.now.sh/'

function getList(type, userId, cb) {
	queue.push({ id: userId }, (listErr, listId) => {
		if (listId) {
			const getUrl = listEndpoint + listId + '/catalog/' + type + '/imdb-' + type + '-list.json'
			needle.get(getUrl, { headers }, (err, resp) => {
				if (err)
					cb(err)
				else if (!resp || !resp.body)
					cb('Empty list response from endpoint')
				else
					cb(false, resp.body)
			})
		} else
			cb(listErr || 'Could not get watchlist id')
	})
}

app.get('/:imdbUser/catalog/:type/:id.json', (req, res) => {
	function fail(err) {
		console.error(err)
		res.writeHead(500)
		res.end(JSON.stringify({ err: 'handler error' }))
	}
	if (req.params.imdbUser && ['movie','series'].indexOf(req.params.type) > -1)
		getList(req.params.type, req.params.imdbUser, (err, resp) => {
			if (resp)
				res.send(resp)
			else 
				fail(err)
		})
	else
		fail('Unknown request parameters')
})

module.exports = app
