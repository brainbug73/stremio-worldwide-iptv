const { config, proxy } = require('internal')
const base64 = require('base-64')
const async = require('async')
const hls = require('./hls')
const map = require('./map')

const defaults = {
	name: 'Worldwide Free IPTV',
	prefix: 'wwfreeiptv_',
	icon: 'https://1.bp.blogspot.com/-rpY21C2cVVc/XBDa1uQ3cHI/AAAAAAAAAQU/K55jh053eHQNhj75HokXh9WJfmDchcHVwCLcBGAs/s1600/FREE%2BWORLD%2BBIG%2BMIX%2B2000%252B%2BLIVE%2BHD%2BIPTV%2BPLAYLIST%2BM3U%2BLINKSKODIUPDATE.jpg',
	paginate: 100
}

hls.init({ prefix: defaults.prefix, type: 'tv', config })

const defaultTypes = []

for (let key in map)
	defaultTypes.push({
		name: key,
		m3u: 'https://raw.githubusercontent.com/freearhey/iptv/master/channels/' + map[key] + '.m3u'
	})

const types = []

for (let i = 0; defaultTypes[i]; i++)
	if (config['show_'+i])
		types.push(defaultTypes[i])

const catalogs = []

if (config.style == 'Catalogs')
	for (let i = 0; types[i]; i++)
		if (types[i].m3u)
			catalogs.push({
				name: types[i].name,
				id: defaults.prefix + 'cat_' + i,
				type: 'tv',
				extra: [ { name: 'search' }, { name: 'skip' } ]
			})

function atob(str) {
    return Buffer.from(str, 'base64').toString('binary');
}

const { addonBuilder, getInterface, getRouter } = require('stremio-addon-sdk')

if (!catalogs.length)
	catalogs.push({
		id: defaults.prefix + 'cat',
		name: defaults.name,
		type: 'tv',
		extra: [{ name: 'search' }]
	})

const metaTypes = ['tv']

if (config.style == 'Channels')
	metaTypes.push('channel')

const builder = new addonBuilder({
	id: 'org.' + defaults.name.toLowerCase().replace(/[^a-z]+/g,''),
	version: '1.0.0',
	name: defaults.name,
	description: '6000+ free IPTV channels from all over the world.',
	resources: ['stream', 'meta', 'catalog'],
	types: metaTypes,
	idPrefixes: [defaults.prefix],
	icon: defaults.icon,
	catalogs
})

builder.defineCatalogHandler(args => {
	return new Promise((resolve, reject) => {
		const extra = args.extra || {}

		if (config.style == 'Channels') {

			const metas = []

			for (let i = 0; types[i]; i++)
				if (types[i].m3u)
					metas.push({
						name: types[i].name,
						id: defaults.prefix + i,
						type: 'channel',
						poster: types[i].logo,
						posterShape: 'landscape',
						background: types[i].logo,
						logo: types[i].logo
					})

			if (metas.length) {
				if (extra.search) {
					let results = []
					metas.forEach(meta => {
						if (meta.name && meta.name.toLowerCase().includes(extra.search.toLowerCase()))
							results.push(meta)
					})
					if (results.length)
						resolve({ metas: results })
					else
						reject(defaults.name + ' - No search results for: ' + extra.search)
				} else
					resolve({ metas })
			} else
				reject(defaults.name + ' - No M3U URLs set')

		} else if (config.style == 'Catalogs') {

			const skip = parseInt(extra.skip || 0)
			const id = args.id.replace(defaults.prefix + 'cat_', '')

			hls.getM3U((types[id] || {}).m3u, id).then(metas => {
				if (!metas.length)
					reject(defaults.name + ' - Could not get items from M3U playlist: ' + args.id)
				else {
					if (!extra.search)
						resolve({ metas: metas.slice(skip, skip + defaults.paginate) })
					else {
						let results = []
						metas.forEach(meta => {
							if (meta.name && meta.name.toLowerCase().includes(extra.search.toLowerCase()))
								results.push(meta)
						})
						if (results.length)
							resolve({ metas: results })
						else
							reject(defaults.name + ' - No search results for: ' + extra.search)
					}
				}
			}).catch(err => {
				reject(err)
			})
		}
	})
})

builder.defineMetaHandler(args => {
	return new Promise((resolve, reject) => {
		if (config.style == 'Channels') {
			const i = args.id.replace(defaults.prefix, '')
			const meta = {
				name: types[i].name,
				id: defaults.prefix + i,
				type: 'channel',
				poster: types[i].logo,
				posterShape: 'landscape',
				background: types[i].logo,
				logo: types[i].logo
			}
			hls.getM3U(types[i].m3u).then(videos => {
				const dups = []
				meta.videos = videos.filter(el => {
					if (!dups.includes(el.title)) {
						dups.push(el.title)
						return true
					}
					return false
				}).map(el => {
					el.id = defaults.prefix + 'data_' + base64.encode(i + '|||' + el.title)
					return el
				})
				resolve({ meta })
			}).catch(err => {
				reject(err)
			})
		} else if (config.style == 'Catalogs') {
			const i = args.id.replace(defaults.prefix + 'url_', '').split('_')[0]
			hls.getM3U(types[i].m3u, i).then(metas => {
				let meta
				metas.some(el => {
					if (el.id == args.id) {
						meta = el
						return true
					}
				})
				if (meta)
					resolve({ meta })
				else
					reject(defaults.name + ' - Could not get meta item for: ' + args.id)
			}).catch(err => {
				reject(err)
			})
		} else
			console.log('err')
	})
})

builder.defineStreamHandler(args => {
	return new Promise(async (resolve, reject) => {
		if (config.style == 'Channels') {
			const data = atob(decodeURIComponent(args.id.replace(defaults.prefix + 'data_', '')))
			const idx = data.split('|||')[0]
			const title = data.split('|||')[1]
			hls.getM3U(types[idx].m3u).then(videos => {

				videos = videos.filter(el => { return el.title == title })

				if (!(videos || []).length) {
					resolve({ streams: [] })
					return
				}

				let streams = []

				const queue = async.queue((task, cb) => {
					const url = decodeURIComponent(task.id.replace(defaults.prefix + 'url_', ''))
					hls.processStream(proxy.addProxy(url)).then(results => {
						streams = streams.concat(results || [])
						cb()
					}).catch(e => { cb() })
				}, 10)

				queue.drain = () => {
					let streamIdx = 1
					streams = streams.map(el => {
						if (el.title.startsWith('Stream')) {
							el.title = 'Stream #' + streamIdx
							streamIdx++
						}
						return el
					})
					resolve({ streams })
				}

				videos.forEach(el => { queue.push(el) })

			}).catch(err => {
				reject(err)
			})
		} else if (config.style == 'Catalogs') {
			const url = atob(decodeURIComponent(args.id.replace(defaults.prefix + 'url_', '').split('_')[1]))
			const streams = await hls.processStream(proxy.addProxy(url))
			resolve({ streams: streams || [] })
		}
	})
})

const addonInterface = getInterface(builder)

module.exports = getRouter(addonInterface)
