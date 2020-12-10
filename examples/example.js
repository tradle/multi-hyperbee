const MultiHyperbee = require('../')
const hyperswarm = require('hyperswarm')
const crypto = require('crypto')
const pump = require('pump')
const { promisify } = require('util')
const auth = require('hypercore-peer-auth')
const Protocol = require('hypercore-protocol')

const { keys, storage } = require('minimist')(process.argv.slice(2), {
  alias: {
    k: 'keys',
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
  if (!keys || !keys.length) {
    return false
  }

  let keysArr = keys.split(',')


  for (let i=0; i<keysArr.length; i++)
    await db.addPeer(keysArr[i].trim())
  process.stdin.on('data', async (data) => {
    let text = data.toString('utf-8').trim()
    await db.put(`${storage}_${text.replace(/[^a-zA-Z]/g, '')}`, { text })
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

  // swarm.on('connection', (socket, info) => db.onConnection(socket, info))
  swarm.on('connection', async (socket, info) => {
    let stream = await db.replicate(info.client, {stream: socket, live: true})
    pump(socket, stream, socket)
  })
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
