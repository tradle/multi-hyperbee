const MultiHyperbee = require('../')
const hyperswarm = require('hyperswarm')
const crypto = require('crypto')
const pump = require('pump')
const { promisify } = require('util')
const auth = require('hypercore-peer-auth')
const Protocol = require('hypercore-protocol')

const { key, storage } = require('minimist')(process.argv.slice(2), {
  alias: {
    k: 'key',
    s: 'storage'
  }
})
if (!storage) {
  printUsage()
  process.exit(0)
}

const topicHex = crypto.createHash('sha256')
  .update('imdb')
  .digest()

// console.log(`topic: ${topicHex.toString('hex')}`)
let data = {
  firstName: 'J',
  lastName: 'S',
  someField: Math.random(),
  friends: ['Claire', 'Martha', 'Jake', 'Sean']
}

const OPTIONS = { keyEncoding: 'utf-8', valueEncoding: 'json' }

start()
.then((started) => started  &&  console.log('Please enter some data'))

async function start() {
  const db = new MultiHyperbee(storage, OPTIONS )
  await db.ready()
  const diffHyperbee = await db.getDiff() // after db.ready() there is no need to await for diffFeed

  let diffFeed = diffHyperbee.feed
  console.log(`${storage} diff key: ${diffFeed.key.toString('hex')}`)
  if (!key || !key.length) {
    return false
  }

  peer = await db.addPeer(key)
  process.stdin.on('data', async (data) => {
    await db.put(`peer_${storage}`, {
      text: data.toString('utf-8').trim(),
    })
  })

  let rkey = `${storage}_123`
  await db.put(rkey, data)
  await startSwarm(db, topicHex)
  return true
}

async function startSwarm(db, topic) {
  var swarm = hyperswarm()
  swarm.join(topic, {
    lookup: true,
    announce: true
  })

  swarm.on('connection', (socket, info) => db.onConnection(socket, info))
}

function printUsage () {
  console.log(function () {
  /*
  Usage:
  Options:
      -k, --key              print usage
      -s, --storage          file path where the model resides
  */
  }.toString()
  .split(/\n/)
  .slice(2, -2)
  .join('\n'))

  process.exit(0)
}
